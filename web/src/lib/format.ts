import { formatUnits, parseUnits } from "viem"

export const USDC_DECIMALS = 6
export const TINYBAR_DECIMALS = 8 // native value on chain
export const STATUS = ["None", "Active", "Frozen", "Matured", "Defaulted"] as const
export const ACTION = ["OK", "WARN", "FREEZE", "DEFAULT"] as const
export type Status = (typeof STATUS)[number]
export type Action = (typeof ACTION)[number]
export const statusName = (n: number | bigint | string): Status => STATUS[Number(n)] ?? "None"
export const actionName = (n: number | bigint | string): Action => ACTION[Number(n)] ?? "OK"

const big = (v: bigint | string | number) => (typeof v === "bigint" ? v : BigInt(v))

/** Decimal string with locale grouping; keeps at least `minFrac` and at most `maxFrac` fraction digits. */
export const fmtDecimal = (s: string, minFrac = 0, maxFrac = 6) => {
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac }).format(n)
}
export const fmtUnits = (v: bigint | string | number, decimals: number, minFrac = 0, maxFrac = decimals) => fmtDecimal(formatUnits(big(v), decimals), minFrac, Math.min(maxFrac, decimals))
/** Settlement amounts: "4.95" (two decimals, up to six). */
export const fmtUsdc = (v: bigint | string | number) => fmtUnits(v, USDC_DECIMALS, 2, 6)
/** Prices are settlement base units per whole bond: "0.99". */
export const fmtPrice = (v: bigint | string | number) => (big(v) === 0n ? "—" : fmtUnits(v, USDC_DECIMALS, 2, 6))
export const parseUsdc = (s: string) => parseUnits(s.trim(), USDC_DECIMALS)
export const fmtHbar = (tinybar: bigint | string | number, maxFrac = 4) => fmtUnits(tinybar, TINYBAR_DECIMALS, 0, maxFrac)
export const parseTinybar = (hbar: string) => parseUnits(hbar.trim(), TINYBAR_DECIMALS)
/** The JSON-RPC relay takes native value in 18-decimal weibar and stores tinybar (÷1e10) on chain. */
export const parseWeibar = (hbar: string) => parseUnits(hbar.trim(), 18)
/** 8-decimal Chainlink answer → "$0.0612". */
export const fmtUsd8 = (v: bigint | string | number) => "$" + fmtUnits(v, 8, 2, 4)
export const fmtBps = (bps: bigint | string | number | null, frac = 2) => (bps === null ? "—" : (Number(big(bps)) / 100).toFixed(frac) + "%")
export const fmtInt = (v: bigint | string | number) => new Intl.NumberFormat().format(big(v))
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`
export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** Locale timestamp plus the UTC form for a tooltip. */
export const fmtTime = (unix: bigint | string | number) => {
  const d = new Date(Number(unix) * 1000)
  return { local: d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }), utc: d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC") }
}
export const fmtDuration = (secs: number) => {
  const s = Math.abs(Math.round(secs))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}
/** "in 2d 4h" before the moment, "3h ago" after it. */
export const countdown = (unix: bigint | string | number, nowSec = Date.now() / 1000) => {
  const diff = Number(unix) - nowSec
  return diff >= 0 ? `in ${fmtDuration(diff)}` : `${fmtDuration(diff)} ago`
}
export const intervalName = (secs: bigint | string | number) => {
  const s = Number(secs)
  if (s % 31_536_000 === 0) return s === 31_536_000 ? "annual" : `every ${s / 31_536_000} years`
  if (s % 2_592_000 === 0) return s === 2_592_000 ? "monthly" : `every ${s / 2_592_000} months`
  if (s % 604_800 === 0) return s === 604_800 ? "weekly" : `every ${s / 604_800} weeks`
  if (s % 86_400 === 0) return s === 86_400 ? "daily" : `every ${s / 86_400} days`
  return `every ${fmtDuration(s)}`
}

// --- order maths (BondMarket.cost / fee) ---------------------------------------------------------------------------
/** Settlement owed for `amount` bond base units at `price` per whole bond (floored, like BondMarket.cost). */
export const orderCost = (amount: bigint, price: bigint, bondDecimals: number) => (amount * price) / 10n ** BigInt(bondDecimals)
export const orderFee = (cost: bigint, feeBps: bigint | number) => (cost * BigInt(feeBps)) / 10_000n
/** What the buyer must have approved and in balance: cost plus the taker fee. */
export const buyerTotal = (amount: bigint, price: bigint, bondDecimals: number, feeBps: bigint | number) => {
  const cost = orderCost(amount, price, bondDecimals)
  return { cost, fee: orderFee(cost, feeBps), total: cost + orderFee(cost, feeBps) }
}
/** Annual coupon on the current ask, in bps (faceValue * couponRateBps / price). */
export const currentYieldBps = (faceValue: bigint, couponRateBps: bigint, price: bigint) => (price === 0n ? couponRateBps : (faceValue * couponRateBps) / price)
/** Coupon per whole bond per period: face * rate * interval / (10000 * year). */
export const couponPerBond = (faceValue: bigint, couponRateBps: bigint, couponInterval: bigint) => (faceValue * couponRateBps * couponInterval) / (10_000n * 31_536_000n)
/** Positive integer bond amount (bond decimals are 0 on the demo bond; other decimals parse as units). */
export const parseAmount = (s: string, bondDecimals: number) => {
  const t = s.trim()
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("Amount must be a number")
  if ((t.split(".")[1]?.length ?? 0) > bondDecimals) throw new Error(bondDecimals === 0 ? "Amount must be a whole number of bonds" : `Amount allows at most ${bondDecimals} decimals`)
  const v = parseUnits(t, bondDecimals)
  if (v <= 0n) throw new Error("Amount must be positive")
  return v
}
