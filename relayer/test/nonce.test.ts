import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { relay } from "../src/index.ts"
import type { Gate, VerdictJson } from "../src/riskgate.ts"

const fixture: VerdictJson = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"))
const nonce = BigInt(fixture.verdict.nonce)

const stub = (lastNonce: bigint, submit: Gate["submit"] = async () => assert.fail("write attempted")): Gate => ({
  address: fixture.riskGate,
  snapshot: async () => ({ lastNonce }),
  signer: async () => fixture.signer!,
  submit,
})

test("nonce <= lastNonce is skipped without writing", async () => {
  assert.deepEqual(await relay(fixture, { gate: stub(nonce), dry: false }), { skipped: "already-applied" })
  assert.deepEqual(await relay(fixture, { gate: stub(nonce + 1n), dry: false }), { skipped: "already-applied" })
})

test("nonce > lastNonce submits; --dry stops before the write", async () => {
  const receipt = { txHash: "0xab", status: "success", hashscan: "x" } as const
  assert.deepEqual(await relay(fixture, { gate: stub(nonce - 1n, async () => receipt), dry: false }), receipt)
  assert.deepEqual(await relay(fixture, { gate: stub(nonce - 1n), dry: true }), { dry: true, nonce: "4", lastNonce: "3" })
})

test("bad signature exits 2 before any RPC", async () => {
  // flip a nibble of r (the v byte is normalised by recovery, so tampering it would not count)
  const tampered = { ...fixture, signature: fixture.signature.replace(/^0x(.)/, (_, c) => `0x${c === "0" ? "1" : "0"}`) as `0x${string}` }
  const gate: Gate = { ...stub(0n), snapshot: async () => assert.fail("rpc attempted") }
  await assert.rejects(relay(tampered, { gate, signer: fixture.signer, dry: false }), { code: 2 })
})
