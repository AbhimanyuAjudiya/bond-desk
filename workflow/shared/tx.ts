// Legacy (type 0) transaction signing inside the enclave; hashio and Sepolia both accept it.
import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const asKey = (raw: string): Hex => (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex
export type LegacyTx = { chainId: number; to: Address; data: Hex; gas: bigint; gasPrice: bigint; nonce: number; value?: bigint }
export const signLegacy = (key: Hex, tx: LegacyTx): Promise<Hex> =>
  privateKeyToAccount(key).signTransaction({ type: "legacy", value: 0n, ...tx })
export const addressOf = (key: Hex): Address => privateKeyToAccount(key).address
