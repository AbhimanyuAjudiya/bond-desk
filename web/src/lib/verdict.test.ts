import { describe, expect, it } from "vitest"
import { privateKeyToAccount } from "viem/accounts"
import fixture from "./fixtures/verdict.json" // copy of relayer/test/fixture.json (signed with a throwaway key)
import { VERDICT_TYPES, parseVerdictBlob, toVerdict, verdictDomain, verifyVerdict } from "./verdict"

const line = `2026-09-10T12:00:00Z coverage=105% action=FREEZE nonce=4 VERDICT_JSON ${JSON.stringify(fixture)}`

describe("VERDICT_JSON parsing", () => {
  it("accepts a bare object, the log line, and a log containing the line", () => {
    expect(parseVerdictBlob(JSON.stringify(fixture)).verdict.nonce).toBe("4")
    expect(parseVerdictBlob(line).verdict.action).toBe(2)
    expect(parseVerdictBlob("noise\n" + line + "\nmore noise").signature).toBe(fixture.signature)
  })
  it("rejects malformed blobs with a plain message", () => {
    expect(() => parseVerdictBlob("hello")).toThrow(/No JSON object/)
    expect(() => parseVerdictBlob("{")).toThrow(/does not parse/)
    expect(() => parseVerdictBlob(JSON.stringify({ ...fixture, verdict: { ...fixture.verdict, action: 7 } }))).toThrow(/action/)
    expect(() => parseVerdictBlob(JSON.stringify({ ...fixture, signature: "0x12" }))).toThrow(/signature/)
    expect(() => parseVerdictBlob(JSON.stringify({ ...fixture, verdict: { ...fixture.verdict, nonce: "-1" } }))).toThrow(/nonce/)
  })
})

describe("signature verification", () => {
  it("verifies the relayer fixture against its signer and rejects others", async () => {
    const j = parseVerdictBlob(JSON.stringify(fixture))
    expect(await verifyVerdict(j, fixture.signer as `0x${string}`)).toBe(true)
    expect(await verifyVerdict(j, "0x0000000000000000000000000000000000000001")).toBe(false)
    expect(await verifyVerdict({ ...j, verdict: { ...j.verdict, nonce: "5" } }, fixture.signer as `0x${string}`)).toBe(false)
  })
  it("round-trips a verdict signed with the workflow's typed data", async () => {
    const key = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
    const signer = privateKeyToAccount(key)
    const verdict = { bondId: "1", action: 1 as const, coverageObserved: "762", issuedAt: "1789034121", nonce: "9" }
    const riskGate = "0x1dFF1d5458D6a6f6af46014de76474DC3170C31B"
    const signature = await signer.signTypedData({ domain: verdictDomain(296, riskGate), types: VERDICT_TYPES, primaryType: "Verdict", message: toVerdict(verdict) })
    expect(await verifyVerdict({ verdict, signature, chainId: 296, riskGate, txHash: null }, signer.address)).toBe(true)
    expect(await verifyVerdict({ verdict, signature, chainId: 295, riskGate, txHash: null }, signer.address)).toBe(false)
  })
})
