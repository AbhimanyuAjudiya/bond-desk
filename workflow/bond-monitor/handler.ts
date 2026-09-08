// Confidential bond risk monitor. Everything in run() executes inside the TEE:
// secrets (signer key, thresholds) are read once, Hedera is read over JSON-RPC, the verdict is
// signed in-enclave, and only the public verdict + signature leave as a log line / return value.
import { HTTPClient, hexToBase64, type TeeRuntime } from "@chainlink/cre-sdk"
import type { Address, Hex } from "viem"
import { z } from "zod"
import { ACTION, STATUS, decideBond, shouldDeliver } from "../shared/decide"
import { batch, call, ethCall, gasPrice, hex, nonceOf, rpc } from "../shared/rpc"
import { addressOf, asKey, signLegacy } from "../shared/tx"
import { type Verdict, decodeSnapshot, encodeSnapshot, encodeSubmit, signVerdict, toJson, verdictDigest } from "../shared/verdict"

const address = z.custom<Address>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v))
export const configSchema = z.object({
  schedule: z.string(),
  hederaRpcUrl: z.string().startsWith("https://"),
  chainId: z.number().int(),
  riskGate: address,
  bondId: z.number().int().positive(),
  deliver: z.enum(["return", "direct"]),
  gasLimit: z.string().regex(/^\d+$/),
  donReport: z.boolean(),
  secretIds: z.object({
    signerKey: z.string(),
    submitKey: z.string(),
    warnBps: z.string(),
    freezeBps: z.string(),
    defaultBps: z.string(),
  }),
})
export type Config = z.infer<typeof configSchema>

// Public, coarse bucket so logs never reveal where the private thresholds sit.
const bucket = (bps: bigint) => (bps >= 15000n ? ">=150%" : bps >= 12000n ? "120-150%" : bps >= 10000n ? "100-120%" : "<100%")

export const run = async (runtime: TeeRuntime<Config>, client = new HTTPClient()) => {
  const c = runtime.config
  const ids = c.secretIds
  const direct = c.deliver === "direct"

  // ONE batched secrets round-trip (the submit key only when we deliver ourselves).
  const wanted = [ids.signerKey, ids.warnBps, ids.freezeBps, ids.defaultBps, ...(direct ? [ids.submitKey] : [])]
  const secrets = runtime.getSecrets(wanted.map((id) => ({ id }))).result()
  const secret = (id: string) => {
    const s = secrets[id]
    if (!s) throw new Error(`secret missing: ${id}`)
    return s.value
  }
  const signerKey = asKey(secret(ids.signerKey))
  const policy = {
    warnBelowBps: BigInt(secret(ids.warnBps)),
    freezeBelowBps: BigInt(secret(ids.freezeBps)),
    defaultBelowBps: BigInt(secret(ids.defaultBps)),
  }
  const submitKey = direct ? asKey(secret(ids.submitKey)) : undefined

  // HTTP #1: snapshot (+ nonce and gas price when delivering direct) in one JSON-RPC batch.
  const bondId = BigInt(c.bondId)
  const r = rpc(runtime, c.hederaRpcUrl, "9s", client)
  const calls = [ethCall(c.riskGate, encodeSnapshot(bondId))]
  if (submitKey) calls.push(nonceOf(addressOf(submitKey)), gasPrice())
  const [snapRaw, nonceRaw, gasRaw] = batch(r, calls)
  const snap = decodeSnapshot(snapRaw as Hex)
  const tag = `bond-monitor bond=${bondId}`
  if (!snap.feedFresh) {
    runtime.log(`${tag} feed-stale`)
    return { status: "FEED_STALE" }
  }

  const { action, reason } = decideBond({ coverageBps: snap.coverageBps, status: snap.status }, policy)
  const verdict: Verdict = {
    bondId,
    action,
    coverageObserved: snap.coverageBps,
    issuedAt: BigInt(Math.floor(runtime.now().getTime() / 1000)),
    nonce: snap.lastNonce + 1n,
  }
  const signature = await signVerdict(signerKey, verdict, c.chainId, c.riskGate) // key never leaves the enclave
  runtime.log(
    `${tag} status=${STATUS[snap.status] ?? snap.status} coverage=${bucket(snap.coverageBps)} action=${ACTION[action]} reason=${reason} nonce=${verdict.nonce}`,
  )

  // HTTP #2 (direct mode only): relay the verdict ourselves instead of returning it.
  let txHash: Hex | undefined
  if (submitKey && shouldDeliver(action, snap.status)) {
    const signed = await signLegacy(submitKey, {
      chainId: c.chainId,
      to: c.riskGate,
      data: encodeSubmit(verdict, signature),
      gas: BigInt(c.gasLimit),
      gasPrice: hex(gasRaw),
      nonce: Number(hex(nonceRaw)),
    })
    txHash = call(r, "eth_sendRawTransaction", [signed]) as Hex
    runtime.log(`${tag} delivered tx=${txHash}`)
  }

  const json = toJson(verdict, signature, c.chainId, c.riskGate, txHash ?? null)
  runtime.log(`VERDICT_JSON ${JSON.stringify(json)}`)
  if (c.donReport) {
    // Only the 32-byte digest crosses back to the DON; the DON signs it as an EVM report.
    runtime
      .usingTheDons()
      .report({
        encodedPayload: hexToBase64(verdictDigest(verdict, c.chainId, c.riskGate)),
        encoderName: "evm",
        signingAlgo: "ecdsa",
        hashingAlgo: "keccak256",
      })
      .result()
    runtime.log(`${tag} don-report=ok`)
  }
  const { txHash: _null, ...result } = json // null is not CRE-serializable; the log line keeps it
  return txHash ? { ...result, txHash } : result
}
