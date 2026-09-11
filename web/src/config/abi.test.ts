import { describe, expect, it } from "vitest"
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem"
import { erc20Abi, lifecycleAbi, marketAbi, oracleAbi, registryAbi, riskGateAbi, vaultAbi } from "./abi"
import { generatedAbis } from "./errors-abi"

// The typed ABIs the app calls must stay a subset of the ABIs generated from the contracts (scripts/sync-abi.sh).
const selectors = (abi: readonly unknown[]) =>
  new Set((abi as (AbiFunction | AbiEvent)[]).filter((f) => f.type === "function" || f.type === "event").map((f) => (f.type === "function" ? toFunctionSelector(f) : toEventSelector(f))))

describe("typed ABIs match the generated ones", () => {
  it.each([
    ["BondRegistry", registryAbi],
    ["BondMarket", marketAbi],
    ["BondLifecycle", lifecycleAbi],
    ["CollateralVault", vaultAbi],
    ["RiskGate", riskGateAbi],
    ["NavOracle", oracleAbi],
    ["MockUSDC", erc20Abi],
  ] as const)("%s", (name, abi) => {
    const generated = selectors(generatedAbis[name]!)
    for (const f of abi as readonly (AbiFunction | AbiEvent)[]) {
      if (f.type !== "function") continue
      expect(generated.has(toFunctionSelector(f)), `${name}.${f.name} missing from api/src/abi/${name}.json`).toBe(true)
    }
  })
})
