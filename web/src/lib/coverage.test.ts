import { describe, expect, it } from "vitest"
import { coverageBand, gaugeFraction } from "./coverage"

describe("coverage bands relative to the vault floor", () => {
  it("maps the demo numbers", () => {
    expect(coverageBand(null, 300n).key).toBe("stale")
    expect(coverageBand(299n, 300n).key).toBe("below")
    expect(coverageBand(300n, 300n).key).toBe("thin")
    expect(coverageBand(592n, 300n).key).toBe("thin")
    expect(coverageBand(600n, 300n).key).toBe("covered")
    expect(coverageBand("762", "300").key).toBe("covered")
    expect(coverageBand(10_000n, 300n).key).toBe("full")
    expect(coverageBand(2n ** 256n - 1n, 300n).key).toBe("none")
  })
  it("tones match the semantic colours", () => {
    expect(coverageBand(100n, 300n).tone).toBe("bad")
    expect(coverageBand(400n, 300n).tone).toBe("warn")
    expect(coverageBand(700n, 300n).tone).toBe("ok")
  })
  it("gauge is monotonic with the floor at one third", () => {
    expect(gaugeFraction(0n, 300n)).toBe(0)
    expect(gaugeFraction(300n, 300n)).toBeCloseTo(1 / 3)
    expect(gaugeFraction(600n, 300n)).toBeCloseTo(2 / 3)
    expect(gaugeFraction(10_000n, 300n)).toBeCloseTo(1)
    expect(gaugeFraction(20_000n, 300n)).toBeCloseTo(1)
    expect(gaugeFraction(450n, 300n)).toBeGreaterThan(gaugeFraction(320n, 300n))
  })
})
