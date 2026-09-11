import type { Address } from "viem"
import dep from "../../../deployments/testnet.json"

// Read at build time from deployments/testnet.json (written by contracts/script/Deploy.s.sol); nothing is hard-coded here.
const a = (k: keyof typeof dep) => dep[k] as Address
export const DEP = {
  chainId: dep.chainId as number,
  registry: a("registry"),
  market: a("market"),
  vault: a("vault"),
  lifecycle: a("lifecycle"),
  riskGate: a("riskGate"),
  oracle: a("oracle"),
  token: a("token"),
  settlement: a("settlement"),
  signer: a("signer"),
  deployer: a("deployer"),
  bondId: BigInt(dep.bondId),
} as const
export const CONTRACT_NAMES: Record<string, string> = {
  [DEP.registry.toLowerCase()]: "BondRegistry",
  [DEP.market.toLowerCase()]: "BondMarket",
  [DEP.vault.toLowerCase()]: "CollateralVault",
  [DEP.lifecycle.toLowerCase()]: "BondLifecycle",
  [DEP.riskGate.toLowerCase()]: "RiskGate",
  [DEP.oracle.toLowerCase()]: "NavOracle",
  [DEP.token.toLowerCase()]: "Bond token (ATS)",
  [DEP.settlement.toLowerCase()]: "USDC (mock)",
}
