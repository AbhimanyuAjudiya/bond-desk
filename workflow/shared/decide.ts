// Pure policy shared by both workflows. Thresholds arrive as secrets; nothing here logs.
export type Action = 0 | 1 | 2 | 3
export const ACTION = ["OK", "WARN", "FREEZE", "DEFAULT"] as const
// BondRegistry.Status: 0 = unregistered bond id.
export const STATUS = ["None", "Active", "Frozen", "Matured", "Defaulted"] as const
export type Decision<T> = T & { reason: string }

export type BondPolicy = { warnBelowBps: bigint; freezeBelowBps: bigint; defaultBelowBps: bigint }
export type BondState = { coverageBps: bigint; status: number }

// DEFAULT is a coverage floor (defaultBelowBps, 0 = disabled) or a manual admin action; runs are
// stateless so there is no grace-period timer.
export const decideBond = (s: BondState, p: BondPolicy): Decision<{ action: Action }> => {
  if (s.status === 0) return { action: 0, reason: "unknown-bond" }
  if (s.status === 3 || s.status === 4) return { action: 0, reason: "terminal-status" }
  if (p.defaultBelowBps > 0n && s.coverageBps < p.defaultBelowBps) return { action: 3, reason: "below-default-floor" }
  if (s.coverageBps < p.freezeBelowBps) return { action: 2, reason: "below-freeze" }
  if (s.coverageBps < p.warnBelowBps) return { action: 1, reason: "below-warn" }
  return { action: 0, reason: "healthy" }
}

// Skip verdicts the chain would reject: FREEZE on a frozen bond, DEFAULT on a defaulted one.
export const shouldDeliver = (action: Action, status: number): boolean =>
  action !== 0 && status !== 0 && !(action === 2 && status === 2) && !(action === 3 && status === 4) // ponytail: WARN re-sent every run

export type LiqPolicy = { triggerHf: bigint; targetHf: bigint; maxRepay: bigint; maxDeposit: bigint; cooldownSecs: bigint }
export type LiqState = {
  collateral: bigint
  debt: bigint
  price: bigint
  vusdBal: bigint
  vethBal: bigint
  lastUpdateTime: bigint
  now: bigint
}
export type LiqPlan = Decision<{ hf: bigint; repay: bigint; deposit: bigint }>

const LT = 78n
const min = (...xs: bigint[]) => xs.reduce((a, b) => (a < b ? a : b))
// ChallengeLending: HF x100 = collateral * price * 78 / (100 * debt)
export const hfX100 = (c: bigint, d: bigint, p: bigint): bigint => (d === 0n ? 10n ** 9n : (c * p * LT) / (100n * d))

export const decideLiq = (s: LiqState, p: LiqPolicy): LiqPlan => {
  const hf = hfX100(s.collateral, s.debt, s.price)
  if (s.debt === 0n) return { hf, repay: 0n, deposit: 0n, reason: "no-debt" }
  if (hf > p.triggerHf) return { hf, repay: 0n, deposit: 0n, reason: "safe" }
  if (s.now - s.lastUpdateTime < p.cooldownSecs) return { hf, repay: 0n, deposit: 0n, reason: "cooldown" }
  const targetDebt = (s.collateral * s.price * LT) / (100n * p.targetHf) // repay just enough
  const repay = min(s.debt > targetDebt ? s.debt - targetDebt : 0n, p.maxRepay, s.vusdBal)
  const debtAfter = s.debt - repay
  let deposit = 0n
  if (debtAfter > 0n) {
    const needC = (p.targetHf * 100n * debtAfter + s.price * LT - 1n) / (s.price * LT) // ceil
    if (needC > s.collateral) deposit = min(needC - s.collateral, p.maxDeposit, s.vethBal)
  }
  if (repay === 0n && deposit === 0n) return { hf, repay, deposit, reason: "no-reserve" }
  return { hf, repay, deposit, reason: "defend" }
}
