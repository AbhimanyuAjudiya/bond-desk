import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, InsufficientFundsError, decodeErrorResult, hexToString, isHex, toFunctionSelector, type Hex } from "viem"
import { errorsAbi } from "../config/errors-abi"
import { STATUS, fmtBps, fmtTime, fmtUsdc, statusName } from "./format"

// ATS puts the failing check's error selector in the bytes32 reason (ats/README.md "canTransferFrom").
const ATS_REASONS: Record<string, string> = {
  [toFunctionSelector("InvalidKycStatus()")]: "KYC status invalid",
  [toFunctionSelector("IsPaused()")]: "the token is paused",
  [toFunctionSelector("AccountIsBlocked(address)")]: "the account is frozen (on the token's control list)",
  [toFunctionSelector("InsufficientAllowance(address,address)")]: "the operator's token allowance is too low",
  [toFunctionSelector("InsufficientBalance(address,uint256,uint256,bytes32)")]: "the seller does not hold that many bonds",
}
const EIP1066: Record<string, string> = { "0x10": "disallowed", "0x11": "allowed", "0x42": "paused", "0x54": "insufficient funds", "0x50": "transfer failed" }

/** True when the only thing the token objected to is the operator's allowance: KYC, freeze and pause all passed. */
export const isAllowanceOnly = (reason: Hex): boolean => reason.slice(0, 10).toLowerCase() === toFunctionSelector("InsufficientAllowance(address,address)")

/** bytes32 reason → sentence fragment: an ATS error selector, a short string, or the raw selector. */
export const explainReason = (reason: Hex): string => {
  const sel = reason.slice(0, 10).toLowerCase()
  if (ATS_REASONS[sel]) return ATS_REASONS[sel]!
  try {
    const s = hexToString(reason, { size: 32 }).replace(/\0+$/, "")
    if (s.length > 0 && /^[\x20-\x7e]+$/.test(s)) return s
  } catch { /* not a string */ }
  return `reason ${sel}`
}

const dt = (unix: bigint) => fmtTime(unix).local
const SENTENCES: Record<string, (a: readonly unknown[]) => string> = {
  ComplianceRejected: ([code, reason]) => `The token refused this transfer: ${explainReason(reason as Hex)} (code ${code}${EIP1066[String(code)] ? `, ${EIP1066[String(code)]}` : ""}).`,
  BondNotActive: ([id, s]) => `Bond ${id} is ${statusName(s as number)}; only Active bonds can be traded.`,
  OrderNotFound: ([id]) => `Order #${id} no longer exists (filled or cancelled).`,
  OrderExpired: ([id]) => `Order #${id} has expired.`,
  NotMaker: () => "Only the wallet that placed this order can cancel it.",
  BadAmount: () => "The amount is zero, larger than the order, or rounds to nothing in settlement units.",
  BadPrice: () => "The price must be greater than zero.",
  BadExpiry: () => "The expiry must be in the future (or zero for good-till-cancelled).",
  PriceOutOfBand: ([p, mark, band]) => `Price ${fmtUsdc(p as bigint)} is more than ${Number(band) / 100}% away from the oracle mark ${fmtUsdc(mark as bigint)}.`,
  BondTransferFailed: () => "The bond token returned false from transferFrom.",
  FeeTooHigh: () => "The fee exceeds the market's maximum.",
  BadStatus: ([s]) => `The bond is ${statusName(s as number)}, which does not allow this action.`,
  CouponNotDue: ([next]) => `The next coupon is not due until ${dt(next as bigint)}.`,
  NoMoreCoupons: () => "Every coupon up to maturity has been paid.",
  CouponUnderfunded: ([due, funded]) => `The coupon needs ${fmtUsdc(due as bigint)} USDC but the pool holds ${fmtUsdc(funded as bigint)} USDC; fund the pool first.`,
  NoCoupon: () => "That coupon has not been paid yet.",
  AlreadyClaimed: () => "This wallet has already claimed that coupon.",
  NothingToClaim: () => "This wallet held no bonds at the coupon snapshot, so there is nothing to claim.",
  NotMatured: ([m]) => `The bond matures on ${dt(m as bigint)}; redemption opens then.`,
  NothingToRedeem: () => "This wallet holds no bonds to redeem.",
  PrincipalUnderfunded: ([need, funded]) => `Redeeming needs ${fmtUsdc(need as bigint)} USDC of principal but the pool holds ${fmtUsdc(funded as bigint)} USDC.`,
  AlreadyScheduled: () => "The next coupon run is already scheduled.",
  SendFailed: () => "Sending HBAR to the recipient failed.",
  CoverageTooLow: ([after, min]) => `Withdrawing that much would leave coverage at ${fmtBps(after as bigint)}, below the ${fmtBps(min as bigint)} floor.`,
  DirectDepositNotAllowed: () => "Send collateral through deposit(bondId), not a plain transfer.",
  AlreadySeized: () => "The collateral has already been seized after a DEFAULT verdict.",
  NotSeized: () => "The collateral has not been seized, so there is no pro-rata claim.",
  BadSignature: () => "The verdict signature does not recover to RiskGate's trusted signer.",
  StaleNonce: ([got, last]) => `Verdict nonce ${got} is not above the last applied nonce ${last}; it was already applied or superseded.`,
  StaleVerdict: ([issued, now]) => `The verdict was issued at ${dt(issued as bigint)}, too long before chain time ${dt(now as bigint)}.`,
  FutureVerdict: ([issued, now]) => `The verdict is dated ${dt(issued as bigint)}, ahead of chain time ${dt(now as bigint)}.`,
  BadAction: ([a]) => `Unknown verdict action ${a}.`,
  NotFrozen: ([s]) => `The bond is ${statusName(s as number)}, not Frozen; there is nothing to unfreeze.`,
  NotAdmin: () => "Only the desk admin can do this.",
  NotIssuer: () => "Only the bond's issuer can do this.",
  NotGate: () => "Only the risk gate can do this.",
  StaleFeed: ([updated, after]) => `The HBAR/USD feed is stale: last update ${dt(updated as bigint)}, allowed age ${Number(after) / 60} minutes.`,
  BadAnswer: () => "The HBAR/USD feed returned a non-positive price.",
  UnknownBond: ([id]) => `Bond ${id} is not registered.`,
  InvalidTerms: () => "The bond terms are invalid.",
  AccessControlUnauthorizedAccount: ([acct]) => `${acct} does not hold the role this action needs.`,
  ERC20InsufficientAllowance: ([, allowance, needed]) => `USDC allowance too low: ${fmtUsdc(allowance as bigint)} approved, ${fmtUsdc(needed as bigint)} needed. Approve first.`,
  ERC20InsufficientBalance: ([, balance, needed]) => `Not enough USDC: balance ${fmtUsdc(balance as bigint)}, needed ${fmtUsdc(needed as bigint)}.`,
  ReentrancyGuardReentrantCall: () => "Reentrant call rejected.",
}

/** Revert data → plain sentence, or null when it is not something the desk knows. */
export const explainRevert = (data: Hex | undefined): string | null => {
  if (!data || !isHex(data) || data.length < 10) return null
  try {
    const { errorName, args } = decodeErrorResult({ abi: errorsAbi, data })
    const say = SENTENCES[errorName]
    if (say) return say(args ?? [])
    if (errorName === "Error") return String(args?.[0] ?? "Reverted")
    if (errorName === "Panic") return `The contract hit a panic (code ${args?.[0]}).`
    return `${errorName}(${(args ?? []).map(String).join(", ")})`
  } catch {
    return null
  }
}

/** Any thrown value (viem, wallet, fetch) → one sentence for a toast. */
export const explainError = (e: unknown): string => {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You rejected the request in your wallet."
    if (e.walk((x) => x instanceof InsufficientFundsError)) return "Not enough HBAR in this wallet to pay for gas."
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    if (revert) {
      const s = explainRevert(revert.raw) ?? (revert.reason ? revert.reason : null)
      if (s) return s
    }
    const withData = e.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | null
    const fromData = withData?.data ? explainRevert(withData.data) : null
    if (fromData) return fromData
    return e.shortMessage || e.message
  }
  if (e instanceof Error) return e.message
  return String(e)
}
export { STATUS }
