import type { Abi } from "viem"
type AbiError = Extract<Abi[number], { type: "error" }>
import Market from "../../../api/src/abi/BondMarket.json"
import Registry from "../../../api/src/abi/BondRegistry.json"
import RiskGate from "../../../api/src/abi/RiskGate.json"
import Lifecycle from "../../../api/src/abi/BondLifecycle.json"
import Vault from "../../../api/src/abi/CollateralVault.json"
import Oracle from "../../../api/src/abi/NavOracle.json"
import Usdc from "../../../api/src/abi/MockUSDC.json"

/** Every custom error any desk contract (or the OpenZeppelin code they inherit) can raise, for decoding revert data. */
export const errorsAbi = [Market, Registry, RiskGate, Lifecycle, Vault, Oracle, Usdc]
  .flatMap((a) => (a as Abi).filter((f): f is AbiError => f.type === "error"))
  .filter((f, i, all) => all.findIndex((g) => g.name === f.name && JSON.stringify(g.inputs) === JSON.stringify(f.inputs)) === i)

export const generatedAbis = { BondMarket: Market, BondRegistry: Registry, RiskGate, BondLifecycle: Lifecycle, CollateralVault: Vault, NavOracle: Oracle, MockUSDC: Usdc } as Record<string, Abi>
