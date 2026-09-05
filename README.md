# Bond Desk on Hedera

A compliant corporate bond issued with Hedera's Asset Tokenization Studio, traded on an
on-chain order book that enforces KYC at every fill, paying coupons on a self-scheduled
timer (Hedera Schedule Service), valued with Chainlink price data, and guarded by a
confidential risk monitor (Chainlink CRE) whose rules never leave the enclave.

Built for ETHOnline 2026.

## Layout

```
contracts/   BondRegistry, BondMarket, CollateralVault, NavOracle, BondLifecycle, RiskGate
ats/         ATS interfaces, testnet addresses, bond creation script
harness/     Foundry harness for Hedera (HSS / HTS helpers, mocks, deploy + verify scripts)
workflow/    Chainlink CRE confidential workflows (bond monitor, liquidation protection)
relayer/     verdict relayer (CRE -> Hedera)
api/         Bond API + Bazantic gateway and recipe
docs/        blueprint, technical reference, evidence
```
