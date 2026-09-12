import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import { getConnInfo } from "@hono/node-server/conninfo"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { BaseError, getAddress, verifyMessage, type Address, type Hex } from "viem"
import * as chain from "./chain.ts"
import * as mirror from "./mirror.ts"
import { openapi } from "./openapi.ts"
import Market from "./abi/BondMarket.json" with { type: "json" }
import RiskGate from "./abi/RiskGate.json" with { type: "json" }
import Registry from "./abi/BondRegistry.json" with { type: "json" }
import Lifecycle from "./abi/BondLifecycle.json" with { type: "json" }
import Vault from "./abi/CollateralVault.json" with { type: "json" }

const PORT = Number(process.env.PORT ?? 8787)
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "")
const TTL = Number(process.env.CACHE_TTL_MS ?? 10_000)
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? "./public" // web/ build output (vite build → api/public), served when present
const HASHSCAN = "https://hashscan.io/testnet"
const MIN_GAS_TINYBAR = 100_000_000 // 1 HBAR covers several fills at testnet gas prices
const KYC_WINDOW_SEC = 300 // a signed KYC request is good for five minutes
const KYC_RATE = { limit: 3, windowMs: 3_600_000 } // per address and per IP

// Every bigint in a response serialises as a decimal string.
;(BigInt.prototype as any).toJSON = function (this: bigint) { return this.toString() }

// ponytail: single-process TTL cache keyed by route; in-flight promises are shared, failures are not cached
const cache = new Map<string, { exp: number; p: Promise<unknown> }>()
const cached = <T>(key: string, fn: () => Promise<T>, ttl = TTL): Promise<T> => {
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return hit.p as Promise<T>
  const p = fn()
  cache.set(key, { exp: Date.now() + ttl, p })
  p.catch(() => cache.delete(key))
  return p
}

const idOf = (raw: string) => (/^\d+$/.test(raw) ? BigInt(raw) : null)
const bondCount = () => cached("bondCount", chain.bondCount)
const exists = async (id: bigint) => id >= 1n && id <= (await bondCount())
const allIds = async () => Array.from({ length: Number(await bondCount()) }, (_, i) => BigInt(i + 1))
const now = () => BigInt(Math.floor(Date.now() / 1000))

const summary = (id: bigint) => cached(`bond:${id}`, async () => {
  const t = await chain.terms(id)
  const [[bestBid, bestAsk], snap, symbol] = await Promise.all([chain.quote(id), chain.snapshot(id), chain.symbol(t.token)])
  return {
    id, symbol, token: t.token, settlement: t.settlement, vault: chain.dep.vault,
    faceValue: t.faceValue, couponRateBps: t.couponRateBps, couponInterval: t.couponInterval, nextCoupon: t.nextCoupon, maturity: t.maturity,
    status: chain.STATUS[t.status] ?? String(t.status),
    mark: snap.mark, coverageBps: snap.feedFresh ? snap.coverageBps : null, bestBid, bestAsk,
    currentYieldBps: bestAsk > 0n ? (t.faceValue * t.couponRateBps) / bestAsk : t.couponRateBps,
    links: { token: `${HASHSCAN}/contract/${t.token}`, orderbook: `${PUBLIC_URL}/bonds/${id}/orderbook`, risk: `${PUBLIC_URL}/bonds/${id}/risk` },
    terms: t,
  }
})

const withBond = (fn: (id: bigint, c: Context) => Promise<Response>) => async (c: Context) => {
  const id = idOf(c.req.param("id") ?? "")
  if (id === null || !(await exists(id))) return c.json({ error: "bond-not-found" }, 404)
  return fn(id, c)
}

const app = new Hono()
app.use("*", cors())

// --- single-page app -----------------------------------------------------------------------------------------------
// A browser navigation (Accept: text/html first) gets the app on every path except the JSON-only ones, so /bonds/1 is a
// page in a browser and the same JSON as before for fetch/curl/agents. Nothing is served when web/ has not been built.
const indexHtml = existsSync(join(PUBLIC_DIR, "index.html")) ? readFileSync(join(PUBLIC_DIR, "index.html"), "utf8") : null
const JSON_ONLY = new Set(["/openapi.json", "/healthz"])
if (indexHtml) {
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && !JSON_ONLY.has(c.req.path) && (c.req.header("accept") ?? "").trimStart().startsWith("text/html")) return c.html(indexHtml)
    await next()
  })
  app.use("*", serveStatic({ root: PUBLIC_DIR }))
}

// --- bonds -----------------------------------------------------------------------------------------------------------
app.get("/bonds", async (c) => {
  const bonds = await Promise.all((await allIds()).map(summary))
  return c.json({ bonds: bonds.map(({ terms: _t, ...b }) => b) })
})

app.get("/bonds/:id", withBond(async (id, c) => c.json(await summary(id))))

// ponytail: the book is what changes right after a user's own tx, so it is cached for 3 s at most
app.get("/bonds/:id/orderbook", withBond(async (id, c) => c.json(await cached(`book:${id}`, async () => {
  const [[bestBid, bestAsk], orders, fills] = await Promise.all([chain.quote(id), chain.openOrders(id, now()), mirror.events(chain.dep.market, Market, "Filled", id, 50)])
  const row = ({ orderId, maker, amount, price, expiry }: chain.Order) => ({ orderId, maker, amount, price, expiry })
  return {
    bondId: id, bestBid, bestAsk,
    bids: orders.filter((o) => !o.isSell).sort((a, b) => Number(b.price - a.price)).map(row),
    asks: orders.filter((o) => o.isSell).sort((a, b) => Number(a.price - b.price)).map(row),
    trades: fills.map((f) => ({ orderId: f.args.orderId, maker: f.args.maker, taker: f.args.taker, amount: f.args.amount, price: f.args.price, txHash: f.txHash, timestamp: f.timestamp })),
  }
}, Math.min(TTL, 3_000)))))

app.get("/bonds/:id/risk", withBond(async (id, c) => c.json(await cached(`risk:${id}`, async () => {
  const [snap, [v]] = await Promise.all([chain.snapshot(id), mirror.events(chain.dep.riskGate, RiskGate, "VerdictApplied", id, 1)])
  return {
    bondId: id, status: chain.STATUS[snap.status] ?? String(snap.status),
    coverageBps: snap.feedFresh ? snap.coverageBps : null, mark: snap.mark, lastNonce: snap.lastNonce, blockTime: snap.timestamp,
    lastVerdict: v ? { action: chain.ACTION[v.args.action] ?? String(v.args.action), coverageObserved: v.args.coverageObserved, nonce: v.args.nonce, txHash: v.txHash, timestamp: v.timestamp } : null,
  }
}))))

app.get("/bonds/:id/verdicts", withBond(async (id, c) => c.json(await cached(`verdicts:${id}`, async () => {
  const rows = await mirror.events(chain.dep.riskGate, RiskGate, "VerdictApplied", id, 100)
  return {
    bondId: id,
    verdicts: rows.map((v) => ({ action: chain.ACTION[v.args.action] ?? String(v.args.action), coverageObserved: v.args.coverageObserved, nonce: v.args.nonce, relayer: v.args.relayer, txHash: v.txHash, timestamp: v.timestamp })),
  }
}))))

// --- activity ----------------------------------------------------------------------------------------------------------
// ATS emits KycGranted/KycRevoked(address indexed account, address indexed operator); verified against the testnet token's logs.
const TokenEvents = [
  { type: "event", name: "KycGranted", inputs: [{ name: "account", type: "address", indexed: true }, { name: "operator", type: "address", indexed: true }] },
  { type: "event", name: "KycRevoked", inputs: [{ name: "account", type: "address", indexed: true }, { name: "operator", type: "address", indexed: true }] },
]
// One BondToken source per registered bond, read from the registry at boot (bond 1's `token` from the artifact when the
// RPC is unreachable, so the process still comes up); restart the API after registering a bond.
const tokens = await allIds().then((ids) => Promise.all(ids.map(async (id) => (await chain.terms(id)).token))).catch(() => [chain.dep.token])
const SOURCES = [
  { contract: "BondMarket", address: chain.dep.market, abi: Market },
  { contract: "BondLifecycle", address: chain.dep.lifecycle, abi: Lifecycle },
  { contract: "RiskGate", address: chain.dep.riskGate, abi: RiskGate },
  { contract: "CollateralVault", address: chain.dep.vault, abi: Vault },
  { contract: "BondRegistry", address: chain.dep.registry, abi: Registry },
  ...tokens.map((address) => ({ contract: "BondToken", address, abi: TokenEvents })),
]
app.get("/events", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200)
  const all = await cached("events", async () => {
    const pages = await Promise.all(SOURCES.map(async (s) => mirror.decodeAll(s.abi, await mirror.logs(s.address)).map((e) => ({ contract: s.contract, address: s.address, ...e }))))
    return pages.flat().sort((a, b) => Number(b.timestamp) - Number(a.timestamp) || a.contract.localeCompare(b.contract))
  })
  return c.json({ events: all.slice(0, limit) })
})

// --- wallets -----------------------------------------------------------------------------------------------------------
app.get("/wallets/:address/eligibility", async (c) => {
  const raw = c.req.param("address") ?? ""
  if (!chain.ADDRESS_RE.test(raw)) return c.json({ error: "bad-address" }, 400)
  const address = raw as Address
  const q = c.req.query("bondId")
  const one = q === undefined ? undefined : idOf(q)
  if (one === null || (one !== undefined && !(await exists(one)))) return c.json({ error: "bond-not-found" }, 404)
  const ids = one !== undefined ? [one] : await allIds()
  const [acct, toks, checks] = await Promise.all([
    mirror.account(address),
    mirror.tokens(address),
    Promise.all(ids.map(async (id) => {
      const b = await summary(id)
      return { id, token: b.token, active: b.status === "Active", kycGranted: (await chain.kycStatus(b.token, address)) === 1 }
    })),
  ])
  const bonds = checks.map(({ id, token, active, kycGranted }) => {
    const reason = !acct ? "no-hedera-account" : !kycGranted ? "no-kyc" : !active ? "bond-not-active" : "kyc-granted"
    return { bondId: id, token, kycGranted, canHold: reason === "kyc-granted", reason }
  })
  const tinybar = acct?.balance.balance ?? 0
  return c.json({
    address, hederaAccount: acct?.account ?? null, hbarTinybar: String(tinybar), hbarSufficientForGas: tinybar >= MIN_GAS_TINYBAR,
    tokens: toks.map((t) => ({ tokenId: t.token_id, balance: String(t.balance) })), bonds,
  })
})

// --- testnet KYC desk ---------------------------------------------------------------------------------------------------
// The wallet proves control with a fresh EIP-191 signature; the compliance-officer key (API environment) then performs
// exactly what ats/script/CreateBond.s.sol does. Testnet only: the officer here is a bot that approves anyone who asks.
export const kycMessage = (verb: "request" | "revocation", address: Address, minute: number) => `Bond Desk testnet KYC ${verb} for ${getAddress(address)} at ${minute}`
const hits = new Map<string, number[]>() // ponytail: in-memory per process; a shared store if the API ever runs more than one instance
const pending = new Set<string>()
const rateLimited = (key: string) => {
  const t = Date.now()
  const recent = (hits.get(key) ?? []).filter((x) => t - x < KYC_RATE.windowMs)
  hits.set(key, recent)
  if (recent.length >= KYC_RATE.limit) return Math.ceil((recent[0]! + KYC_RATE.windowMs - t) / 1000)
  recent.push(t)
  return 0
}
const clientIp = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || getConnInfo(c).remote.address || "unknown"
const kycDesk = (verb: "request" | "revocation") => async (c: Context) => {
  if (!chain.officer) return c.json({ error: "kyc-desk-offline", message: "The testnet KYC desk needs COMPLIANCE_OFFICER_KEY in the API environment; it is not set on this deployment." }, 503)
  const raw = c.req.param("address") ?? ""
  if (!chain.ADDRESS_RE.test(raw)) return c.json({ error: "bad-address" }, 400)
  const address = getAddress(raw)
  const body = await c.req.json().catch(() => null) as { minute?: unknown; signature?: unknown } | null
  const minute = Number(body?.minute)
  const signature = body?.signature
  if (!Number.isInteger(minute) || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return c.json({ error: "bad-request", message: "Body must be {minute: unix minute, signature: 0x…}." }, 400)
  const ageSec = Math.floor(Date.now() / 1000) - minute * 60
  if (ageSec > KYC_WINDOW_SEC || ageSec < -60) return c.json({ error: "stale-signature", message: "Sign a fresh request; signatures are accepted for five minutes." }, 400)
  const ok = await verifyMessage({ address, message: kycMessage(verb, address, minute), signature: signature as Hex }).catch(() => false)
  if (!ok) return c.json({ error: "bad-signature", message: "The signature does not match the wallet in the URL." }, 401)
  const key = address.toLowerCase()
  if (pending.has(key)) return c.json({ error: "pending", message: "A KYC transaction for this wallet is still in flight." }, 409)
  const wait = rateLimited(`addr:${key}`) || rateLimited(`ip:${clientIp(c)}`)
  if (wait) return c.json({ error: "rate-limited", message: `Three KYC requests per hour; try again in ${wait} s.`, retryAfterSec: wait }, 429)
  pending.add(key)
  try {
    const results = []
    for (const id of await allIds()) {
      const t = await chain.terms(id)
      if (verb === "revocation" && t.issuer.toLowerCase() === key) return c.json({ error: "issuer-kyc", message: "The issuer's own KYC is not self-service." }, 403)
      const granted = (await chain.kycStatus(t.token, address)) === 1
      if (verb === "request") results.push(granted ? { bondId: id, token: t.token, result: "already-granted", txHashes: [] } : { bondId: id, token: t.token, result: "granted", txHashes: await chain.grantKyc(t.token, address, t.issuer) })
      else results.push(granted ? { bondId: id, token: t.token, result: "revoked", txHashes: [await chain.revokeKyc(t.token, address)] } : { bondId: id, token: t.token, result: "not-granted", txHashes: [] })
    }
    return c.json({ address, officer: chain.officer.address, action: verb === "request" ? "grant" : "revoke", results })
  } catch (e) {
    if (e instanceof chain.Upstream) throw e
    const detail = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e)
    return c.json({ error: "tx-failed", message: detail }, 502)
  } finally {
    pending.delete(key)
  }
}
app.post("/wallets/:address/kyc", kycDesk("request"))
app.delete("/wallets/:address/kyc", kycDesk("revocation"))

// --- meta ----------------------------------------------------------------------------------------------------------------
app.get("/healthz", async (c) => {
  const block = await chain.blockNumber().catch(() => null)
  return c.json({ ok: block !== null, chainId: chain.CHAIN_ID, block, kycDesk: chain.officer !== null })
})

app.get("/openapi.json", (c) => c.json(openapi(PUBLIC_URL)))
app.notFound((c) => c.json({ error: "not-found" }, 404))
app.onError((e, c) => {
  if (e instanceof chain.Upstream) return c.json({ error: "upstream", detail: e.detail }, 502)
  console.error(e)
  return c.json({ error: "internal" }, 500)
})

serve({ fetch: app.fetch, port: PORT }, () => console.log(`bond-desk-api listening on :${PORT} (${PUBLIC_URL})${indexHtml ? ", serving web/ from " + PUBLIC_DIR : ""}${chain.officer ? ", kyc desk on" : ""}`))
