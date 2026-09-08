// Runs the TEE handler against a fake TeeRuntime + fake HTTPClient: proves the HTTP budget
// (1 call in return mode, 2 in direct mode), the EIP-712 signature, and that no secret leaks.
import { describe, expect, test } from "bun:test"
import type { HTTPClient, TeeRuntime } from "@chainlink/cre-sdk"
import { type Abi, type Hex, encodeFunctionResult, verifyTypedData } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import RiskGateAbi from "../shared/abi/RiskGate.json"
import { VERDICT_TYPES, domain, fromJson } from "../shared/verdict"
import { type Config, run } from "./handler"

const abi = RiskGateAbi as Abi
const SIGNER_KEY = `0x${"11".repeat(32)}` as Hex
const SECRETS: Record<string, string> = {
  VERDICT_SIGNER_KEY: SIGNER_KEY,
  HEDERA_SUBMIT_KEY: `0x${"22".repeat(32)}`,
  BOND_WARN_BPS: "13001",
  BOND_FREEZE_BPS: "11001",
  BOND_DEFAULT_BPS: "5001",
}
const config: Config = {
  schedule: "0 */2 * * * *",
  hederaRpcUrl: "https://testnet.hashio.io/api",
  chainId: 296,
  riskGate: "0x000000000000000000000000000000000000dEaD",
  bondId: 1,
  deliver: "return",
  gasLimit: "500000",
  donReport: true,
  secretIds: {
    signerKey: "VERDICT_SIGNER_KEY",
    submitKey: "HEDERA_SUBMIT_KEY",
    warnBps: "BOND_WARN_BPS",
    freezeBps: "BOND_FREEZE_BPS",
    defaultBps: "BOND_DEFAULT_BPS",
  },
}
const TX = `0x${"ab".repeat(32)}`

const snapshot = (over: Record<string, unknown> = {}) =>
  encodeFunctionResult({
    abi,
    functionName: "snapshot",
    result: { coverageBps: 10500n, feedFresh: true, status: 1, mark: 0n, collateral: 0n, lastNonce: 4n, lastAction: 0, nextCoupon: 0n, maturity: 0n, timestamp: 0n, ...over },
  })

const RESULTS: Record<string, (snap: Hex) => string> = {
  eth_call: (s) => s,
  eth_getTransactionCount: () => "0x7",
  eth_gasPrice: () => "0x2540be400",
  eth_sendRawTransaction: () => TX,
}

const harness = (cfg: Config, snap: Hex) => {
  const logs: string[] = []
  const bodies: string[] = []
  let reports = 0
  const runtime = {
    config: cfg,
    now: () => new Date(1_789_012_345_000),
    log: (m: string) => logs.push(m),
    getSecrets: (reqs: { id: string }[]) => ({
      result: () => Object.fromEntries(reqs.map((r) => [r.id, { id: r.id, value: SECRETS[r.id] }])),
    }),
    usingTheDons: () => ({ report: () => ({ result: () => ++reports }) }),
  } as unknown as TeeRuntime<Config>
  const client = {
    sendRequest: (_rt: unknown, input: { body: string }) => {
      const body = Buffer.from(input.body, "base64").toString()
      bodies.push(body)
      const out = (JSON.parse(body) as { id: number; method: string }[]).map((c) => ({ jsonrpc: "2.0", id: c.id, result: RESULTS[c.method](snap) }))
      return { result: () => ({ statusCode: 200, body: new TextEncoder().encode(JSON.stringify(out)) }) }
    },
  } as unknown as HTTPClient
  return { runtime, client, logs, bodies, reports: () => reports }
}

describe("bond-monitor handler", () => {
  test("return mode: one HTTP call, FREEZE verdict signed by the enclave key", async () => {
    const h = harness(config, snapshot())
    const out: any = await run(h.runtime, h.client)
    expect(h.bodies.length).toBe(1)
    expect(out).toMatchObject({ verdict: { bondId: "1", action: 2, coverageObserved: "10500", issuedAt: "1789012345", nonce: "5" }, chainId: 296, riskGate: config.riskGate })
    expect("txHash" in out).toBe(false)
    const signer = privateKeyToAccount(SIGNER_KEY).address
    expect(await verifyTypedData({ address: signer, domain: domain(296, config.riskGate), types: VERDICT_TYPES, primaryType: "Verdict", message: fromJson(out.verdict), signature: out.signature })).toBe(true)
    const line = h.logs.find((l) => l.startsWith("VERDICT_JSON {"))!
    expect(JSON.parse(line.slice("VERDICT_JSON ".length))).toEqual({ ...out, txHash: null })
    expect(h.logs.some((l) => l.includes("status=Active coverage=100-120% action=FREEZE"))).toBe(true)
    expect(h.reports()).toBe(1)
  })

  test("direct mode: two HTTP calls, the second is eth_sendRawTransaction", async () => {
    const h = harness({ ...config, deliver: "direct", donReport: false }, snapshot())
    const out: any = await run(h.runtime, h.client)
    expect(h.bodies.length).toBe(2)
    expect(h.bodies[0]).toContain("eth_getTransactionCount")
    expect(h.bodies[1]).toContain("eth_sendRawTransaction")
    expect(out.txHash).toBe(TX)
    expect(h.reports()).toBe(0)
  })

  test("direct mode: FREEZE on an already-frozen bond is not delivered", async () => {
    const h = harness({ ...config, deliver: "direct" }, snapshot({ status: 2 }))
    const out: any = await run(h.runtime, h.client)
    expect(h.bodies.length).toBe(1)
    expect("txHash" in out).toBe(false)
    expect(h.logs.some((l) => l.includes("status=Frozen"))).toBe(true)
  })

  test("stale feed: no verdict, no signature", async () => {
    const h = harness(config, snapshot({ feedFresh: false }))
    expect(await run(h.runtime, h.client)).toEqual({ status: "FEED_STALE" })
    expect(h.bodies.length).toBe(1)
    expect(h.logs).toEqual(["bond-monitor bond=1 feed-stale"])
  })

  test("never logs or sends a key or threshold", async () => {
    for (const deliver of ["return", "direct"] as const) {
      const h = harness({ ...config, deliver }, snapshot())
      await run(h.runtime, h.client)
      for (const v of Object.values(SECRETS)) for (const s of [...h.logs, ...h.bodies]) expect(s).not.toContain(v.replace(/^0x/, ""))
    }
  })
})
