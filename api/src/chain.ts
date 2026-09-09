import { readFileSync } from "node:fs"
import { createPublicClient, http, type Abi, type Address } from "viem"
import { hederaTestnet } from "viem/chains"
import { z } from "zod"
import Registry from "./abi/BondRegistry.json" with { type: "json" }
import Market from "./abi/BondMarket.json" with { type: "json" }
import RiskGate from "./abi/RiskGate.json" with { type: "json" }
import IKyc from "./abi/IKyc.json" with { type: "json" }

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const address = z.string().regex(ADDRESS_RE).transform((a) => a as Address)
// Flat deployments/testnet.json written by contracts/script/Deploy.s.sol; only the keys the API reads are validated.
const Deployments = z.object({ chainId: z.literal(hederaTestnet.id), registry: address, market: address, vault: address, riskGate: address })
export const dep = Deployments.parse(JSON.parse(readFileSync(process.env.DEPLOYMENTS_FILE ?? "../deployments/testnet.json", "utf8")))

export const CHAIN_ID = hederaTestnet.id
// hashio rejects JSON-RPC batches over 100 requests (-32203), viem's default batchSize is 1000: cap it so big Promise.alls split into several HTTP batches.
export const client = createPublicClient({ chain: hederaTestnet, transport: http(process.env.HEDERA_RPC_URL, { batch: { batchSize: 100 } }) })

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
