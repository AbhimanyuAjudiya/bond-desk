import { defineChain } from "viem"
import { hederaTestnet } from "viem/chains"

const RPC = import.meta.env.VITE_RPC_URL || "https://testnet.hashio.io/api"
export const HASHSCAN = "https://hashscan.io/testnet"

// viem's hederaTestnet already points at hashio + HashScan; pinned here so a viem upgrade cannot move the app elsewhere.
export const chain = defineChain({
  ...hederaTestnet,
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "HashScan", url: HASHSCAN } },
})
export const RPC_URL = RPC
export const hashscanTx = (hash: string) => `${HASHSCAN}/transaction/${hash}`
export const hashscanAccount = (address: string) => `${HASHSCAN}/account/${address}`
export const hashscanContract = (address: string) => `${HASHSCAN}/contract/${address}`
export const FAUCET = "https://portal.hedera.com/faucet"

// Known gas limits where hashio's eth_estimateGas is wrong (README "gas overrides" table).
export const GAS = {
  vaultWithdraw: 400_000n, // forwards native value
  claimSeized: 400_000n, // forwards native value
  schedule: 3_000_000n, // reaches the 0x16b schedule system contract
  payCoupon: 4_000_000n, // schedule + snapshot + coupon maths
} as const
