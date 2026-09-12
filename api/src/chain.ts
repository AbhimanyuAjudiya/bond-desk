import { readFileSync } from "node:fs"
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { hederaTestnet } from "viem/chains"
import { z } from "zod"
import Registry from "./abi/BondRegistry.json" with { type: "json" }
import Market from "./abi/BondMarket.json" with { type: "json" }
import RiskGate from "./abi/RiskGate.json" with { type: "json" }
import IKyc from "./abi/IATSAdmin.json" with { type: "json" }

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const address = z.string().regex(ADDRESS_RE).transform((a) => a as Address)
// Flat deployments/testnet.json written by contracts/script/Deploy.s.sol; only the keys the API reads are validated.
const Deployments = z.object({
  chainId: z.literal(hederaTestnet.id), registry: address, market: address, vault: address, riskGate: address,
  lifecycle: address, oracle: address, token: address, settlement: address,
  // every registered bond (`token` above is bond 1, kept for the older consumers); the API reads the registry itself
  bonds: z.array(z.object({ id: z.number().int().positive(), symbol: z.string(), token: address, schedule: address })).optional(),
})
export const dep = Deployments.parse(JSON.parse(readFileSync(process.env.DEPLOYMENTS_FILE ?? "../deployments/testnet.json", "utf8")))

export const CHAIN_ID = hederaTestnet.id
const RPC = process.env.HEDERA_RPC_URL
// hashio rejects JSON-RPC batches over 100 requests (-32203), viem's default batchSize is 1000: cap it so big Promise.alls split into several HTTP batches.
export const client = createPublicClient({ chain: hederaTestnet, transport: http(RPC, { batch: { batchSize: 100 } }) })

/** Any RPC / mirror-node failure; `detail` names the upstream method only (never a value). */
export class Upstream extends Error {
  detail: string
  constructor(detail: string) {
    super(`upstream ${detail}`)
    this.detail = detail
  }
}

export const STATUS = ["None", "Active", "Frozen", "Matured", "Defaulted"] as const
export const ACTION = ["OK", "WARN", "FREEZE", "DEFAULT"] as const

export type Terms = {
  token: Address; settlement: Address; issuer: Address; bondDecimals: number; settlementDecimals: number
  faceValue: bigint; couponRateBps: bigint; couponInterval: bigint; nextCoupon: bigint; maturity: bigint; status: number
}
export type Snapshot = {
  coverageBps: bigint; feedFresh: boolean; status: number; mark: bigint; collateral: bigint
  lastNonce: bigint; lastAction: number; nextCoupon: bigint; maturity: bigint; timestamp: bigint
}
export type Order = { orderId: bigint; bondId: bigint; maker: Address; isSell: boolean; amount: bigint; price: bigint; expiry: bigint }

const erc20 = [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const

// Concurrent reads share one JSON-RPC batch (http transport batch), so Promise.all = one round-trip per 100 reads.
const read = <T>(address: Address, abi: unknown, functionName: string, args: readonly unknown[] = []): Promise<T> =>
  client.readContract({ address, abi: abi as Abi, functionName, args }).catch(() => { throw new Upstream(functionName) }) as Promise<T>

export const bondCount = () => read<bigint>(dep.registry, Registry, "bondCount")
export const terms = (bondId: bigint) => read<Terms>(dep.registry, Registry, "terms", [bondId])
export const quote = (bondId: bigint) => read<[bigint, bigint]>(dep.market, Market, "quote", [bondId])
export const snapshot = (bondId: bigint) => read<Snapshot>(dep.riskGate, RiskGate, "snapshot", [bondId])
export const symbol = (token: Address) => read<string>(token, erc20, "symbol")
export const kycStatus = (token: Address, who: Address) => read<number>(token, IKyc, "getKycStatusFor", [who])
export const isSsiIssuer = (token: Address, who: Address) => read<boolean>(token, IKyc, "isIssuer", [who])
export const blockNumber = () => client.getBlockNumber().catch(() => { throw new Upstream("eth_blockNumber") })

/** Open orders for a bond, rebuilt from storage (not logs). expiry 0 = good-till-cancelled. */
export const openOrders = async (bondId: bigint, now: bigint): Promise<Order[]> => {
  const next = await read<bigint>(dep.market, Market, "nextOrderId")
  // ponytail: full scan of every order id ever issued (deleted ones included), 100 reads per HTTP batch (hashio cap);
  // track live ids from OrderPlaced/OrderCancelled/Filled logs if the scan ever costs more than a few round-trips
  const ids = Array.from({ length: Number(next) }, (_, i) => BigInt(i))
  const rows = await Promise.all(ids.map((id) => read<[bigint, Address, boolean, bigint, bigint, bigint]>(dep.market, Market, "orders", [id])))
  return rows
    .map(([bid, maker, isSell, amount, price, expiry], i) => ({ orderId: ids[i]!, bondId: bid, maker, isSell, amount, price, expiry }))
    .filter((o) => o.bondId === bondId && o.amount > 0n && (o.expiry === 0n || o.expiry > now))
}

// --- testnet KYC desk: the compliance officer key signs ATS grantKyc / revokeKyc on behalf of whoever asks ---------
const KEY = process.env.COMPLIANCE_OFFICER_KEY as Hex | undefined
export const officer = KEY && /^0x[0-9a-fA-F]{64}$/.test(KEY) ? privateKeyToAccount(KEY) : null
const wallet = officer ? createWalletClient({ chain: hederaTestnet, account: officer, transport: http(RPC) }) : null
const TEN_YEARS = 3650n * 86_400n

/** Legacy tx with an explicit gas limit (Hedera bills most of the limit, so keep it close), waits for the receipt. */
const send = async (functionName: "addIssuer" | "grantKyc" | "revokeKyc", token: Address, args: readonly unknown[], gas: bigint): Promise<Hex> => {
  if (!wallet) throw new Error("kyc desk offline")
  const call = { address: token, abi: IKyc as Abi, functionName, args, account: wallet.account } as const
  await client.simulateContract(call) // reverts surface here, decoded by viem, before any gas is spent
  const hash = await wallet.writeContract({ ...call, type: "legacy", gas, gasPrice: await client.getGasPrice() })
  const { status } = await client.waitForTransactionReceipt({ hash })
  if (status !== "success") throw new Error(`${functionName} reverted in ${hash}`)
  return hash
}

/** CreateBond.s.sol conventions: SSI issuer registered first, vc id per account, valid from now-1 for ten years. */
export const grantKyc = async (token: Address, account: Address, issuer: Address): Promise<Hex[]> => {
  const txs: Hex[] = []
  if (!(await isSsiIssuer(token, issuer))) txs.push(await send("addIssuer", token, [issuer], 200_000n))
  const now = BigInt(Math.floor(Date.now() / 1000))
  txs.push(await send("grantKyc", token, [account, `vc:testnet:${account.toLowerCase()}`, now - 1n, now + TEN_YEARS, issuer], 300_000n))
  return txs
}
export const revokeKyc = (token: Address, account: Address) => send("revokeKyc", token, [account], 200_000n)
