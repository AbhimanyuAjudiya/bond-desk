import { describe, expect, test } from "bun:test"
import { decideBond, decideLiq, hfX100, policyInt, shouldDeliver } from "./decide"

const policy = { warnBelowBps: 13000n, freezeBelowBps: 11000n, defaultBelowBps: 5000n }
const liq = { triggerHf: 121n, targetHf: 135n, maxRepay: 250000n, maxDeposit: 150n, cooldownSecs: 60n } // test fixture, not the live policy
// Challenge reference position: 5.00 vETH, 7000 vUSD debt, price 2000 (2-decimal units).
const ref = { collateral: 500n, debt: 700000n, price: 200000n, vusdBal: 10_000_000n, vethBal: 1000n, lastUpdateTime: 0n, now: 1000n }

describe("decideBond", () => {
  test("ladder", () => {
    const at = (coverageBps: bigint, p = policy) => decideBond({ coverageBps, status: 1 }, p).action
    expect(at(10999n)).toBe(2)
    expect(at(11000n)).toBe(1)
    expect(at(12999n)).toBe(1)
    expect(at(13000n)).toBe(0)
    expect(at(4999n)).toBe(3)
    expect(at(4999n, { ...policy, defaultBelowBps: 0n })).toBe(2) // floor disabled
  })
  test("unknown and terminal statuses never act", () => {
    for (const status of [0, 3, 4]) expect(decideBond({ coverageBps: 0n, status }, policy).action).toBe(0)
  })
  test("shouldDeliver", () => {
    expect(shouldDeliver(2, 2)).toBe(false) // already frozen
    expect(shouldDeliver(3, 4)).toBe(false) // already defaulted
    expect(shouldDeliver(2, 1)).toBe(true)
    expect(shouldDeliver(1, 2)).toBe(true)
    expect(shouldDeliver(0, 1)).toBe(false)
    expect(shouldDeliver(1, 0)).toBe(false) // unknown bond
  })
})

describe("decideLiq", () => {
  test("reference position has hf 111", () => expect(hfX100(500n, 700000n, 200000n)).toBe(111n))
  test("repays just enough to reach target", () => {
    expect(decideLiq(ref, liq)).toEqual({ hf: 111n, repay: 122223n, deposit: 0n, reason: "defend" })
  })
  test("caps repay then tops up collateral so hf >= target", () => {
    const p = decideLiq(ref, { ...liq, maxRepay: 50000n })
    expect(p.repay).toBe(50000n)
    expect(p.deposit).toBeGreaterThan(0n)
    expect(hfX100(ref.collateral + p.deposit, ref.debt - p.repay, ref.price)).toBeGreaterThanOrEqual(liq.targetHf)
  })
  test("cooldown", () => expect(decideLiq({ ...ref, lastUpdateTime: 950n }, liq).reason).toBe("cooldown"))
  test("safe above trigger", () => expect(decideLiq({ ...ref, collateral: 600n }, liq).reason).toBe("safe"))
  test("no reserve", () => expect(decideLiq({ ...ref, vusdBal: 0n, vethBal: 0n }, liq).reason).toBe("no-reserve"))
})

describe("policyInt", () => {
  test("parses an integer secret and rejects a malformed one without echoing it", () => {
    expect(policyInt("LIQ_TRIGGER_HF", "42")).toBe(42n)
    const bad = "<private, see workflow/README.md>"
    let msg = ""
    try {
      policyInt("LIQ_TRIGGER_HF", bad)
    } catch (e) {
      msg = String(e)
    }
    expect(msg).toBe("Error: secret LIQ_TRIGGER_HF: expected an unsigned integer")
    expect(msg).not.toContain(bad)
  })
})
