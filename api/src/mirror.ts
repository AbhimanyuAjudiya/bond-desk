import { decodeEventLog, encodeEventTopics, type Abi, type Address, type Hex } from "viem"
import { Upstream } from "./chain.ts"

const BASE = process.env.MIRROR_URL ?? "https://testnet.mirrornode.hedera.com/api/v1"

/** GET from the mirror node; 404 → null (unknown account / contract), other failures → Upstream(name); `name` is a fixed label, never the path. */
const get = async <T>(name: string, path: string): Promise<T | null> => {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(8_000) }).catch(() => { throw new Upstream(name) })
  if (res.status === 404) return null
  if (!res.ok) throw new Upstream(name)
  return res.json() as Promise<T>
}

export type Account = { account: string; balance: { balance: number } }
export const account = (evm: Address) => get<Account>("mirror accounts", `/accounts/${evm}`)

export const tokens = async (evm: Address) =>
  (await get<{ tokens: { token_id: string; balance: number }[] }>("mirror tokens", `/accounts/${evm}/tokens?limit=100`))?.tokens ?? []

type Log = { data: Hex; topics: Hex[]; timestamp: string; transaction_hash: Hex; block_number?: number }
export type Event = { args: Record<string, any>; txHash: Hex; timestamp: string }
export type Decoded = Event & { name: string; blockNumber: number | null }

/** Newest `limit` (≤100) logs of a contract, unfiltered: the mirror node's topic-filtered query is capped to a 7-day window, this one is not. */
export const logs = async (contract: Address, limit = 100): Promise<Log[]> =>
  (await get<{ logs: Log[] }>("mirror logs", `/contracts/${contract}/results/logs?order=desc&limit=${limit}`))?.logs ?? []

/** Every log the ABI knows how to decode, in the order given; unknown topics (other facets, ERC-20 noise) are skipped. */
export const decodeAll = (abi: unknown, rows: Log[]): Decoded[] =>
  rows.flatMap((l) => {
    try {
      const { eventName, args } = decodeEventLog({ abi: abi as Abi, data: l.data, topics: l.topics as [Hex, ...Hex[]] })
      return [{ name: String(eventName), args: (args ?? {}) as Record<string, any>, txHash: l.transaction_hash, timestamp: l.timestamp.split(".")[0]!, blockNumber: l.block_number ?? null }]
    } catch {
      return []
    }
  })

/**
 * Latest `limit` events of `eventName` for `bondId` (topic1), newest first.
 * hashio's eth_getLogs and the mirror node's topic-filtered query are both capped to a 7-day window, so we page the
 * contract's newest 100 logs unfiltered (no window needed) and match topics locally.
 * ponytail: one page of 100; follow links.next if one bond's fills ever get buried under 100 newer events
 */
export const events = async (contract: Address, abi: unknown, eventName: string, bondId: bigint, limit: number): Promise<Event[]> => {
  const [topic0, topic1] = encodeEventTopics({ abi: abi as Abi, eventName, args: { bondId } as any })
  return (await logs(contract))
    .filter((l) => l.topics[0] === topic0 && l.topics[1] === topic1)
    .slice(0, limit)
    .map((l) => ({
      args: decodeEventLog({ abi: abi as Abi, eventName, data: l.data, topics: l.topics as [Hex, ...Hex[]] }).args as Record<string, any>,
      txHash: l.transaction_hash,
      timestamp: l.timestamp.split(".")[0]!,
    }))
}
