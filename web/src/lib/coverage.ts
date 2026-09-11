export type Tone = "ok" | "warn" | "bad" | "neutral"
export type Band = { key: "stale" | "below" | "thin" | "covered" | "full" | "none"; label: string; tone: Tone; sentence: string }
const MAX = 2n ** 256n - 1n

/**
 * Bands are relative to the vault's public withdrawal floor (`minCoverageBps`); the enclave's own WARN/FREEZE/DEFAULT
 * thresholds are private and may sit anywhere above it.
 */
export const coverageBand = (bps: bigint | string | number | null, minBps: bigint | string | number): Band => {
  if (bps === null) return { key: "stale", label: "feed stale", tone: "neutral", sentence: "The HBAR/USD feed is stale, so coverage cannot be computed right now." }
  const b = BigInt(bps), m = BigInt(minBps)
  if (b === MAX) return { key: "none", label: "no principal", tone: "neutral", sentence: "No bonds are outstanding, so there is nothing to cover." }
  if (b >= 10_000n) return { key: "full", label: "fully covered", tone: "ok", sentence: "Collateral is worth at least the outstanding principal." }
  if (b >= m * 2n) return { key: "covered", label: "covered", tone: "ok", sentence: `Coverage is at least twice the vault's ${Number(m) / 100}% withdrawal floor.` }
  if (b >= m) return { key: "thin", label: "thin", tone: "warn", sentence: `Coverage is above the vault's ${Number(m) / 100}% withdrawal floor but less than twice it.` }
  return { key: "below", label: "below floor", tone: "bad", sentence: `Coverage is under the vault's ${Number(m) / 100}% floor; the issuer cannot withdraw and a freeze is likely.` }
}
/** 0..1 position on the gauge: the floor sits at one third, twice the floor at two thirds, 100% at the end. */
export const gaugeFraction = (bps: bigint | string | number | null, minBps: bigint | string | number): number => {
  if (bps === null) return 0
  const b = Number(BigInt(bps) > 10_000n ? 10_000n : BigInt(bps)), m = Number(minBps)
  if (m <= 0) return Math.min(b / 10_000, 1)
  if (b <= m) return (b / m) / 3
  if (b <= 2 * m) return 1 / 3 + ((b - m) / m) / 3
  return 2 / 3 + ((b - 2 * m) / (10_000 - 2 * m)) / 3
}
