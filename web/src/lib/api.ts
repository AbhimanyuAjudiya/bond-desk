import type { Address, Hex } from "viem"

// Same origin in production (the API serves the app); VITE_API_URL in dev.
export const API_URL = (import.meta.env.DEV ? import.meta.env.VITE_API_URL || "https://wd6nrvmajt.ap-south-1.awsapprunner.com" : "").replace(/\/$/, "")

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(API_URL + path, { ...init, headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } })
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; detail?: string }
  if (!res.ok) throw new ApiError(res.status, body.error ?? "error", body.message ?? (body.error === "upstream" ? `Hedera upstream unavailable (${body.detail})` : `${body.error ?? res.status}`))
  return body as T
}

// Response shapes (bigints arrive as decimal strings).
export type BondSummary = {
  id: string; symbol: string; token: Address; settlement: Address; vault: Address
  faceValue: string; couponRateBps: string; couponInterval: string; nextCoupon: string; maturity: string
  status: "None" | "Active" | "Frozen" | "Matured" | "Defaulted"
  mark: string; coverageBps: string | null; bestBid: string; bestAsk: string; currentYieldBps: string
  links: { token: string; orderbook: string; risk: string }
}
export type Bond = BondSummary & {
  terms: { token: Address; settlement: Address; issuer: Address; bondDecimals: number; settlementDecimals: number; faceValue: string; couponRateBps: string; couponInterval: string; nextCoupon: string; maturity: string; status: number }
}
export type Order = { orderId: string; maker: Address; amount: string; price: string; expiry: string }
export type Trade = { orderId: string; maker: Address; taker: Address; amount: string; price: string; txHash: Hex; timestamp: string }
export type Orderbook = { bondId: string; bestBid: string; bestAsk: string; bids: Order[]; asks: Order[]; trades: Trade[] }
export type Risk = {
  bondId: string; status: BondSummary["status"]; coverageBps: string | null; mark: string; lastNonce: string; blockTime: string
  lastVerdict: { action: "OK" | "WARN" | "FREEZE" | "DEFAULT"; coverageObserved: string; nonce: string; txHash: Hex; timestamp: string } | null
}
export type VerdictRow = { action: "OK" | "WARN" | "FREEZE" | "DEFAULT"; coverageObserved: string; nonce: string; relayer: Address; txHash: Hex; timestamp: string }
export type Eligibility = {
  address: Address; hederaAccount: string | null; hbarTinybar: string; hbarSufficientForGas: boolean
  tokens: { tokenId: string; balance: string }[]
  bonds: { bondId: string; token: Address; kycGranted: boolean; canHold: boolean; reason: "kyc-granted" | "no-kyc" | "no-hedera-account" | "bond-not-active" }[]
}
export type DeskEvent = { contract: string; address: Address; name: string; args: Record<string, string | number | boolean>; txHash: Hex; timestamp: string; blockNumber: number | null }
export type Health = { ok: boolean; chainId: number; block: string | null; kycDesk?: boolean }
export type KycResult = { address: Address; officer: Address; action: "grant" | "revoke"; results: { bondId: string; token: Address; result: string; txHashes: Hex[] }[] }

export const kycMessage = (verb: "request" | "revocation", checksummed: Address, minute: number) => `Bond Desk testnet KYC ${verb} for ${checksummed} at ${minute}`
