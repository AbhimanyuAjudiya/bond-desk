import { describe, expect, it } from "vitest"
import { BaseError, ContractFunctionExecutionError, ContractFunctionRevertedError, encodeAbiParameters, encodeErrorResult, toFunctionSelector } from "viem"
import { marketAbi } from "../config/abi"
import { errorsAbi } from "../config/errors-abi"
import { explainError, explainReason, explainRevert } from "./errors"

const pad = (sel: string) => (sel + "0".repeat(64)).slice(0, 66) as `0x${string}`

describe("revert decoding", () => {
  it("decodes the live ComplianceRejected data from hashio", () => {
    // captured with `cast call market fill(1,10) --from investor3`
    const data = "0x5afab9b81000000000000000000000000000000000000000000000000000000000000000fc855b1b00000000000000000000000000000000000000000000000000000000"
    expect(explainRevert(data)).toBe("The token refused this transfer: KYC status invalid (code 0x10, disallowed).")
  })
  it("names every ATS reason and falls back to strings or selectors", () => {
    expect(explainReason(pad(toFunctionSelector("IsPaused()")))).toBe("the token is paused")
    expect(explainReason("0x496e76616c69644b796353746174757300000000000000000000000000000000")).toBe("InvalidKycStatus")
    expect(explainReason(pad("0xdeadbeef"))).toBe("reason 0xdeadbeef")
  })
  it("phrases desk errors from every contract", () => {
    const enc = (errorName: string, args: unknown[]) => encodeErrorResult({ abi: errorsAbi, errorName, args })
    expect(explainRevert(enc("BondNotActive", [1n, 2]))).toBe("Bond 1 is Frozen; only Active bonds can be traded.")
    expect(explainRevert(enc("CoverageTooLow", [250n, 300n]))).toBe("Withdrawing that much would leave coverage at 2.50%, below the 3.00% floor.")
    expect(explainRevert(enc("CouponUnderfunded", [1_360_000n, 990_000n]))).toContain("needs 1.36 USDC but the pool holds 0.99 USDC")
    expect(explainRevert(enc("StaleNonce", [2n, 2n]))).toContain("nonce 2 is not above the last applied nonce 2")
    expect(explainRevert(enc("NotIssuer", []))).toBe("Only the bond's issuer can do this.")
    expect(explainRevert(enc("ERC20InsufficientAllowance", ["0x0000000000000000000000000000000000000001", 0n, 9_999_000n]))).toContain("0.00 approved, 9.999 needed")
    expect(explainRevert(("0x08c379a0" + encodeAbiParameters([{ type: "string" }], ["nope"]).slice(2)) as `0x${string}`)).toBe("nope")
  })
  it("returns null for unknown or empty data", () => {
    expect(explainRevert(undefined)).toBeNull()
    expect(explainRevert("0x")).toBeNull()
    expect(explainRevert("0x12345678")).toBeNull()
  })
  it("walks viem errors down to the raw revert data", () => {
    const raw = encodeErrorResult({ abi: marketAbi, errorName: "ComplianceRejected", args: ["0x10", pad(toFunctionSelector("InvalidKycStatus()"))] })
    const cause = new ContractFunctionRevertedError({ abi: marketAbi, data: raw, functionName: "fill" })
    const err = new ContractFunctionExecutionError(cause, { abi: marketAbi, functionName: "fill", args: [1n, 10n] })
    expect(explainError(err)).toBe("The token refused this transfer: KYC status invalid (code 0x10, disallowed).")
    expect(explainError(new BaseError("Something else", { metaMessages: [] }))).toBe("Something else")
    expect(explainError(new Error("plain"))).toBe("plain")
  })
})
