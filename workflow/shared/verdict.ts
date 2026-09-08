// EIP-712 Verdict: typed, signed in the enclave, verified by RiskGate.submit on Hedera.
import { type Abi, type Address, type Hex, decodeFunctionResult, encodeFunctionData, hashTypedData } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import RiskGateAbi from "./abi/RiskGate.json"
import type { Action } from "./decide"

const abi = RiskGateAbi as Abi

export type Verdict = { bondId: bigint; action: Action; coverageObserved: bigint; issuedAt: bigint; nonce: bigint }
export const VERDICT_TYPES = {
  Verdict: [
    { name: "bondId", type: "uint256" },
    { name: "action", type: "uint8" },
    { name: "coverageObserved", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "nonce", type: "uint64" },
  ],
} as const
export const domain = (chainId: number, verifyingContract: Address) =>
  ({ name: "BondDeskRiskGate", version: "1", chainId, verifyingContract }) as const
const typed = (v: Verdict, chainId: number, gate: Address) =>
  ({ domain: domain(chainId, gate), types: VERDICT_TYPES, primaryType: "Verdict", message: v }) as const

export const signVerdict = (key: Hex, v: Verdict, chainId: number, gate: Address): Promise<Hex> =>
  privateKeyToAccount(key).signTypedData(typed(v, chainId, gate))
export const verdictDigest = (v: Verdict, chainId: number, gate: Address): Hex => hashTypedData(typed(v, chainId, gate))

export const encodeSubmit = (v: Verdict, sig: Hex): Hex => encodeFunctionData({ abi, functionName: "submit", args: [v, sig] })
export const encodeSnapshot = (bondId: bigint): Hex => encodeFunctionData({ abi, functionName: "snapshot", args: [bondId] })

// RiskGate.Snapshot struct (10 fields).
export type Snapshot = {
  coverageBps: bigint
  feedFresh: boolean
  status: number
  mark: bigint
  collateral: bigint
  lastNonce: bigint
  lastAction: number
  nextCoupon: bigint
  maturity: bigint
  timestamp: bigint
}
export const decodeSnapshot = (data: Hex): Snapshot => decodeFunctionResult({ abi, functionName: "snapshot", data }) as Snapshot

// Wire format shared with the relayer (bigints as decimal strings).
export type VerdictJson = {
  verdict: { bondId: string; action: Action; coverageObserved: string; issuedAt: string; nonce: string }
  signature: Hex
  chainId: number
  riskGate: Address
  txHash: Hex | null
}
export const toJson = (v: Verdict, signature: Hex, chainId: number, riskGate: Address, txHash: Hex | null): VerdictJson => ({
  verdict: {
    bondId: v.bondId.toString(),
    action: v.action,
    coverageObserved: v.coverageObserved.toString(),
    issuedAt: v.issuedAt.toString(),
    nonce: v.nonce.toString(),
  },
  signature,
  chainId,
  riskGate,
  txHash,
})
export const fromJson = (j: VerdictJson["verdict"]): Verdict => ({
  bondId: BigInt(j.bondId),
  action: j.action,
  coverageObserved: BigInt(j.coverageObserved),
  issuedAt: BigInt(j.issuedAt),
  nonce: BigInt(j.nonce),
})
