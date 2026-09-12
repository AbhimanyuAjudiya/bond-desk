// Runnable check (node --experimental-strip-types test/smoke.mjs):
//  1. mirror.events decoding against synthetic mirror-node logs (fetch stubbed, no network)
//  2. boots the API against the placeholder deployments file and an unreachable RPC (override with HEDERA_RPC_URL /
//     MIRROR_URL to hit real endpoints) and asserts the public contract: /healthz shape, /openapi.json structure
//     (3.1, all ten operations, unique operationIds, no dangling $ref) and the error shapes 400/404/502.
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters } from "viem"

const deployments = new URL("./deployments.testnet.json", import.meta.url).pathname
process.env.DEPLOYMENTS_FILE = deployments

// --- 1. event decoding -------------------------------------------------------------------------------------------
{
  const Market = JSON.parse(readFileSync(new URL("../src/abi/BondMarket.json", import.meta.url), "utf8"))
  const maker = "0x1111111111111111111111111111111111111111", taker = "0x2222222222222222222222222222222222222222"
  const fill = (bondId, orderId, tx) => ({
    topics: encodeEventTopics({ abi: Market, eventName: "Filled", args: { bondId, orderId } }),
    data: encodeAbiParameters(parseAbiParameters("address, address, uint128, uint128, uint256, uint256"), [maker, taker, 10n, 990000n, 9900000n, 9900n]),
    timestamp: "1700000000.123456789", transaction_hash: tx,
  })
  const placed = { topics: encodeEventTopics({ abi: Market, eventName: "OrderPlaced", args: { orderId: 8n, bondId: 1n, maker } }), data: "0x", timestamp: "1700000001.0", transaction_hash: "0x03" }
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ logs: [placed, fill(2n, 9n, "0x02"), fill(1n, 7n, "0x01"), fill(1n, 5n, "0x00")], links: { next: null } })
  const mirror = await import("../src/mirror.ts")
  const ev = await mirror.events(maker, Market, "Filled", 1n, 1)
  assert.equal(ev.length, 1)
  assert.deepEqual({ ...ev[0], args: { ...ev[0].args } }, { txHash: "0x01", timestamp: "1700000000", args: { bondId: 1n, orderId: 7n, maker, taker, amount: 10n, price: 990000n, cost: 9900000n, fee: 9900n } })
  assert.equal((await mirror.events(maker, Market, "Filled", 1n, 50)).length, 2)
  globalThis.fetch = async () => new Response("", { status: 404 })
  assert.deepEqual(await mirror.events(maker, Market, "Filled", 1n, 50), [])
  assert.equal(await mirror.account(maker), null)
  globalThis.fetch = realFetch
  console.log("decode ok")
}

// --- 2. HTTP contract ----------------------------------------------------------------------------------------------
const port = 18000 + Math.floor(Math.random() * 2000)
const base = `http://localhost:${port}`
const child = spawn(process.execPath, ["--experimental-strip-types", "src/index.ts"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env, PORT: String(port), PUBLIC_URL: base, DEPLOYMENTS_FILE: deployments,
    HEDERA_RPC_URL: process.env.HEDERA_RPC_URL ?? "http://127.0.0.1:9", MIRROR_URL: process.env.MIRROR_URL ?? "http://127.0.0.1:9",
  },
  stdio: ["ignore", "inherit", "inherit"],
})
const get = async (p) => { const r = await fetch(base + p); return [r.status, await r.json()] }

try {
  for (let i = 0; ; i++) {
    try { await fetch(base + "/openapi.json"); break } catch (e) { if (i > 50) throw e; await new Promise((r) => setTimeout(r, 100)) }
  }
  const [hs, h] = await get("/healthz")
  assert.equal(hs, 200); assert.equal(h.chainId, 296); assert.equal(typeof h.ok, "boolean"); assert.ok(!h.ok || /^\d+$/.test(h.block))

  const [os, spec] = await get("/openapi.json")
  assert.equal(os, 200); assert.match(spec.openapi, /^3\.1\./); assert.equal(spec.servers[0].url, base)
  const paths = ["/bonds", "/bonds/{id}", "/bonds/{id}/orderbook", "/bonds/{id}/risk", "/bonds/{id}/verdicts", "/events", "/wallets/{address}/eligibility", "/healthz"]
  for (const p of paths) assert.ok(spec.paths[p]?.get?.operationId, `missing ${p}`)
  assert.ok(spec.paths["/wallets/{address}/kyc"]?.post?.operationId && spec.paths["/wallets/{address}/kyc"]?.delete?.operationId, "missing testnet KYC desk")
  const ops = Object.values(spec.paths).flatMap((p) => Object.values(p).map((o) => o.operationId))
  assert.equal(new Set(ops).size, ops.length, "duplicate operationIds"); assert.equal(ops.length, 10, "operation count drifted; update the Bazantic price table too")
  assert.ok(Array.isArray(spec.paths["/bonds"].get["x-agent-hints"]))
  const refs = JSON.stringify(spec).match(/#\/components\/schemas\/\w+/g).map((r) => r.split("/").pop())
  for (const name of new Set(refs)) assert.ok(spec.components.schemas[name], `dangling $ref ${name}`)

  const [bs, b] = await get("/bonds"); assert.equal(bs, 502); assert.equal(b.error, "upstream"); assert.equal(b.detail, "bondCount")
  assert.deepEqual(await get("/bonds/abc"), [404, { error: "bond-not-found" }])
  assert.deepEqual(await get("/wallets/nope/eligibility"), [400, { error: "bad-address" }])
  const [es, e] = await get("/wallets/0x0000000000000000000000000000000000000001/eligibility")
  assert.equal(es, 502); assert.equal(e.error, "upstream"); assert.ok(!e.detail.includes("0x"), `detail must name a method, not echo input: ${e.detail}`)
  console.log(`smoke ok (healthz ok=${h.ok} block=${h.block}):`, ops.join(", "))
} finally {
  child.kill("SIGTERM")
}
