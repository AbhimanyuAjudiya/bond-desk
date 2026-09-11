import { verifyTypedData, isAddress, isHex, type Address, type Hex } from "viem"

// Wire format printed by the CRE workflow as one `VERDICT_JSON {...}` log line (workflow/shared/verdict.ts, relayer/src).
export type VerdictJson = {
  verdict: { bondId: string; action: 0 | 1 | 2 | 3; coverageObserved: string; issuedAt: string; nonce: string }
  signature: Hex
  chainId: number
  riskGate: Address
  txHash: Hex | null
  signer?: Address
}
export type Verdict = { bondId: bigint; action: number; coverageObserved: bigint; issuedAt: bigint; nonce: bigint }

export const VERDICT_TYPES = {
  Verdict: [
    { name: "bondId", type: "uint256" },
    { name: "action", type: "uint8" },
    { name: "coverageObserved", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "nonce", type: "uint64" },
  ],
} as const
export const verdictDomain = (chainId: number, verifyingContract: Address) => ({ name: "BondDeskRiskGate", version: "1", chainId, verifyingContract }) as const

const uint = (v: unknown, name: string): string => {
  if ((typeof v === "string" && /^\d+$/.test(v)) || (typeof v === "number" && Number.isInteger(v) && v >= 0)) return String(v)
  throw new Error(`verdict.${name} must be a non-negative integer (as a decimal string)`)
}

/** Accepts a bare JSON object, a whole `VERDICT_JSON {...}` log line, or a log with that line somewhere inside. */
export const parseVerdictBlob = (text: string): VerdictJson => {
  const t = text.trim()
  const marker = t.indexOf("VERDICT_JSON")
  const start = t.indexOf("{", marker >= 0 ? marker : 0)
  if (start < 0) throw new Error("No JSON object found; paste the VERDICT_JSON line from the workflow log.")
  let obj: unknown
  try {
    obj = JSON.parse(t.slice(start, t.lastIndexOf("}") + 1))
  } catch {
    throw new Error("The JSON does not parse; paste the complete VERDICT_JSON line.")
  }
  const j = obj as Partial<VerdictJson>
  if (!j || typeof j !== "object" || !j.verdict || typeof j.verdict !== "object") throw new Error("Missing `verdict` object.")
  const action = Number(j.verdict.action)
  if (![0, 1, 2, 3].includes(action)) throw new Error("verdict.action must be 0 (OK), 1 (WARN), 2 (FREEZE) or 3 (DEFAULT).")
  if (typeof j.signature !== "string" || !isHex(j.signature) || j.signature.length !== 132) throw new Error("signature must be a 65-byte 0x hex string.")
  if (typeof j.chainId !== "number") throw new Error("chainId must be a number.")
  if (typeof j.riskGate !== "string" || !isAddress(j.riskGate)) throw new Error("riskGate must be an address.")
  return {
    verdict: { bondId: uint(j.verdict.bondId, "bondId"), action: action as 0 | 1 | 2 | 3, coverageObserved: uint(j.verdict.coverageObserved, "coverageObserved"), issuedAt: uint(j.verdict.issuedAt, "issuedAt"), nonce: uint(j.verdict.nonce, "nonce") },
    signature: j.signature,
    chainId: j.chainId,
    riskGate: j.riskGate,
    txHash: typeof j.txHash === "string" && isHex(j.txHash) ? j.txHash : null,
    ...(typeof j.signer === "string" && isAddress(j.signer) ? { signer: j.signer } : {}),
  }
}

export const toVerdict = (v: VerdictJson["verdict"]): Verdict => ({ bondId: BigInt(v.bondId), action: v.action, coverageObserved: BigInt(v.coverageObserved), issuedAt: BigInt(v.issuedAt), nonce: BigInt(v.nonce) })

/** Pure ECDSA check of the EIP-712 signature against `signer` (what RiskGate.submit does on chain). */
export const verifyVerdict = async (j: VerdictJson, signer: Address): Promise<boolean> => {
  try {
    return await verifyTypedData({ address: signer, domain: verdictDomain(j.chainId, j.riskGate), types: VERDICT_TYPES, primaryType: "Verdict", message: toVerdict(j.verdict), signature: j.signature })
  } catch {
    return false
  }
}
