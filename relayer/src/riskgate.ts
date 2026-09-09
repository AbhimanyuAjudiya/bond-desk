import {
  BaseError,
  HttpRequestError,
  TimeoutError,
  createPublicClient,
  createWalletClient,
  http,
  verifyTypedData,
  type Abi,
  type Address,
  type Hex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { hederaTestnet } from "viem/chains"
import RiskGateAbi from "./abi/RiskGate.json" with { type: "json" }

export const chain = hederaTestnet
export const abi = RiskGateAbi as Abi
export const hashscan = (tx: Hex): string => `${chain.blockExplorers.default.url}/transaction/${tx}`

// --- EIP-712 (duplicated from workflow/shared/verdict.ts; separate package) ---
export type Action = 0 | 1 | 2 | 3
export type Verdict = { bondId: bigint; action: Action; coverageObserved: bigint; issuedAt: bigint; nonce: bigint }
export type VerdictJson = {
  verdict: { bondId: string; action: Action; coverageObserved: string; issuedAt: string; nonce: string }
  signature: Hex
  chainId: number
  riskGate: Address
  txHash: Hex | null
  signer?: Address // fixtures only: lets an offline --dry verify without RiskGate.signer()
}
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
export const fromJson = (j: VerdictJson["verdict"]): Verdict => ({
  bondId: BigInt(j.bondId),
  action: j.action,
  coverageObserved: BigInt(j.coverageObserved),
  issuedAt: BigInt(j.issuedAt),
  nonce: BigInt(j.nonce),
})
export const verifyVerdict = async (signer: Address, chainId: number, gate: Address, v: Verdict, sig: Hex): Promise<boolean> => {
  try {
    return await verifyTypedData({ address: signer, domain: domain(chainId, gate), types: VERDICT_TYPES, primaryType: "Verdict", message: v, signature: sig })
  } catch {
    return false // malformed signature bytes are just a bad signature
  }
}

// --- chain access ---
export type Snapshot = {
  coverageBps: bigint; feedFresh: boolean; status: number; mark: bigint; collateral: bigint
  lastNonce: bigint; lastAction: number; nextCoupon: bigint; maturity: bigint; timestamp: bigint
}
export type Receipt = { txHash: Hex; status: "success" | "reverted"; hashscan: string }
export type Gate = {
  address: Address
  snapshot(bondId: bigint): Promise<Pick<Snapshot, "lastNonce">>
  signer(): Promise<Address>
  submit(v: Verdict, sig: Hex): Promise<Receipt>
}

// retryCount 0: the relayer's own 3-attempt policy is the only retry
const transport = (rpc: string) => http(rpc, { batch: true, retryCount: 0 })

export const liveGate = (rpc: string, address: Address, key?: Hex): Gate => {
  const pub = createPublicClient({ chain, transport: transport(rpc) })
  const at = { address, abi } as const
  return {
    address,
    snapshot: (bondId) => pub.readContract({ ...at, functionName: "snapshot", args: [bondId] }) as Promise<Snapshot>,
    signer: () => pub.readContract({ ...at, functionName: "signer" }) as Promise<Address>,
    submit: async (v, sig) => {
      if (!key) throw new Error("RELAYER_PRIVATE_KEY missing")
      const wallet = createWalletClient({ chain, account: privateKeyToAccount(key), transport: transport(rpc) })
      const call = { ...at, account: wallet.account, functionName: "submit", args: [v, sig] } as const
      await pub.simulateContract(call) // a revert surfaces here, before any gas is spent, and is never retried
      const txHash = await wallet.writeContract({ ...call, type: "legacy", gas: 500_000n, gasPrice: await pub.getGasPrice() })
      const { status } = await pub.waitForTransactionReceipt({ hash: txHash })
      return { txHash, status, hashscan: hashscan(txHash) }
    },
  }
}

export const isTransient = (e: unknown): boolean =>
  e instanceof BaseError && e.walk((c) => c instanceof HttpRequestError || c instanceof TimeoutError) !== null

export const errorMessage = (e: unknown): string =>
  e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e)
