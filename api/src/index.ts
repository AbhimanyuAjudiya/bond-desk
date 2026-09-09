import { serve } from "@hono/node-server"
import { Hono, type Context } from "hono"
import type { Address } from "viem"
import * as chain from "./chain.ts"
import * as mirror from "./mirror.ts"
import { openapi } from "./openapi.ts"
import Market from "./abi/BondMarket.json" with { type: "json" }
import RiskGate from "./abi/RiskGate.json" with { type: "json" }

const PORT = Number(process.env.PORT ?? 8787)
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "")
const TTL = Number(process.env.CACHE_TTL_MS ?? 10_000)
const HASHSCAN = "https://hashscan.io/testnet"
const MIN_GAS_TINYBAR = 100_000_000 // 1 HBAR covers several fills at testnet gas prices

// Every bigint in a response serialises as a decimal string.
;(BigInt.prototype as any).toJSON = function (this: bigint) { return this.toString() }

// ponytail: single-process TTL cache keyed by route; in-flight promises are shared, failures are not cached
const cache = new Map<string, { exp: number; p: Promise<unknown> }>()
const cached = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return hit.p as Promise<T>
  const p = fn()
  cache.set(key, { exp: Date.now() + TTL, p })
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

app.get("/bonds", async (c) => {
  const bonds = await Promise.all((await allIds()).map(summary))
  return c.json({ bonds: bonds.map(({ terms: _t, ...b }) => b) })
})

app.get("/bonds/:id", withBond(async (id, c) => c.json(await summary(id))))

app.get("/bonds/:id/orderbook", withBond(async (id, c) => c.json(await cached(`book:${id}`, async () => {
  const [[bestBid, bestAsk], orders, fills] = await Promise.all([chain.quote(id), chain.openOrders(id, now()), mirror.events(chain.dep.market, Market, "Filled", id, 50)])
  const row = ({ orderId, maker, amount, price, expiry }: chain.Order) => ({ orderId, maker, amount, price, expiry })
  return {
    bondId: id, bestBid, bestAsk,
    bids: orders.filter((o) => !o.isSell).sort((a, b) => Number(b.price - a.price)).map(row),
    asks: orders.filter((o) => o.isSell).sort((a, b) => Number(a.price - b.price)).map(row),
    trades: fills.map((f) => ({ orderId: f.args.orderId, maker: f.args.maker, taker: f.args.taker, amount: f.args.amount, price: f.args.price, txHash: f.txHash, timestamp: f.timestamp })),
  }
}))))

app.get("/bonds/:id/risk", withBond(async (id, c) => c.json(await cached(`risk:${id}`, async () => {
  const [snap, [v]] = await Promise.all([chain.snapshot(id), mirror.events(chain.dep.riskGate, RiskGate, "VerdictApplied", id, 1)])
  return {
    bondId: id, status: chain.STATUS[snap.status] ?? String(snap.status),
    coverageBps: snap.feedFresh ? snap.coverageBps : null, mark: snap.mark, lastNonce: snap.lastNonce, blockTime: snap.timestamp,
    lastVerdict: v ? { action: chain.ACTION[v.args.action] ?? String(v.args.action), coverageObserved: v.args.coverageObserved, nonce: v.args.nonce, txHash: v.txHash, timestamp: v.timestamp } : null,
  }
}))))

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

app.get("/healthz", async (c) => {
  const block = await chain.blockNumber().catch(() => null)
  return c.json({ ok: block !== null, chainId: chain.CHAIN_ID, block })
})

app.get("/openapi.json", (c) => c.json(openapi(PUBLIC_URL)))
app.notFound((c) => c.json({ error: "not-found" }, 404))
app.onError((e, c) => {
  if (e instanceof chain.Upstream) return c.json({ error: "upstream", detail: e.detail }, 502)
  console.error(e)
  return c.json({ error: "internal" }, 500)
})

serve({ fetch: app.fetch, port: PORT }, () => console.log(`bond-desk-api listening on :${PORT} (${PUBLIC_URL})`))
