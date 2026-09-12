import { describe, expect, it } from "vitest"
import { buyerTotal, countdown, couponPerBond, currentYieldBps, fmtHbar, fmtPrice, fmtUsdc, orderCost, parseAmount, parseTinybar, parseUsdc, parseWeibar, shortAddress, spreadMid } from "./format"

describe("order maths", () => {
  it("costs amount * price / 10^bondDecimals like BondMarket.cost", () => {
    expect(orderCost(10n, 990_000n, 0)).toBe(9_900_000n)
    expect(orderCost(10n, 990_000n, 2)).toBe(99_000n)
  })
  it("adds the taker fee in bps on top of the cost", () => {
    expect(buyerTotal(10n, 990_000n, 0, 100)).toEqual({ cost: 9_900_000n, fee: 99_000n, total: 9_999_000n })
    expect(buyerTotal(1n, 1n, 0, 0).total).toBe(1n)
  })
  it("prices parse and print in USDC units", () => {
    expect(parseUsdc("0.99")).toBe(990_000n)
    expect(fmtPrice(990_000n)).toBe("0.99")
    expect(fmtPrice(0n)).toBe("—")
    expect(fmtUsdc(9_999_000n)).toBe("9.999")
    expect(fmtUsdc("100000000")).toBe("100.00")
  })
  it("yield = face * rate / ask, falling back to the coupon rate with no ask", () => {
    expect(currentYieldBps(1_000_000n, 500n, 990_000n)).toBe(505n)
    expect(currentYieldBps(1_000_000n, 500n, 0n)).toBe(500n)
  })
  it("coupon per bond per period follows BondLifecycle._due", () => {
    expect(couponPerBond(1_000_000n, 500n, 86_400n)).toBe(136n) // 5% of 1 USDC for one day
  })
  it("rejects zero and negative amounts", () => {
    expect(parseAmount("5", 0)).toBe(5n)
    expect(() => parseAmount("0", 0)).toThrow()
    expect(() => parseAmount("1.5", 0)).toThrow()
  })
})

describe("HBAR units", () => {
  it("tinybar on chain, weibar on the relay", () => {
    expect(parseTinybar("1")).toBe(100_000_000n)
    expect(parseWeibar("1")).toBe(10n ** 18n)
    expect(fmtHbar(8_000_000_000n)).toBe("80")
    expect(fmtHbar(123_456_789n)).toBe("1.2346")
  })
})

describe("book", () => {
  it("spread and mid from the best bid and ask, null while a side is empty, negative when crossed", () => {
    expect(spreadMid("980000", "990000")).toEqual({ spread: 10_000n, mid: 985_000n, spreadBps: 101n })
    expect(spreadMid("0", "990000")).toBeNull()
    expect(spreadMid("1000000", "990000")?.spread).toBe(-10_000n)
  })
})

describe("text", () => {
  it("shortens addresses and phrases countdowns", () => {
    expect(shortAddress("0xe7F5773A3d8f3dF15FE4474637cCCCF79d2CD3D6")).toBe("0xe7F5…D3D6")
    expect(countdown(1000 + 90_000, 1000)).toBe("in 1d 1h")
    expect(countdown(1000, 1000 + 3_700)).toBe("1h 1m ago")
  })
})
