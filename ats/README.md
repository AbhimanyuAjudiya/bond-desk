# ats/ — Asset Tokenization Studio wiring (Hedera testnet)

Hand-written, ABI-exact Solidity interfaces for the parts of Hedera's [Asset Tokenization Studio](https://github.com/hashgraph/asset-tokenization-studio) that Bond Desk calls, plus the testnet addresses. No ATS source is vendored; every signature, struct field order, role hash and error selector below was checked against the pinned commit.

- Pinned: tag `v.8.0.0-ats`, commit `be4f860e408ec5b1a24d12feb6f872aabff69319`, solc 0.8.28 / cancun.
- Provenance paths are relative to `packages/ats/contracts/contracts/`.
- Remapping: `ats/=ats/src/` (`import {ROLE_KYC} from "ats/ATSRoles.sol";`).

## Files

| File | Contents | Provenance |
|---|---|---|
| `src/ATSRoles.sol` | role ids, `BOND_CONFIG_ID`, `DEFAULT_PARTITION` | `constants/roles.sol` (`keccak256("asset.tokenization.standard.role.<PascalName>")`), `constants/values.sol` (`_DEFAULT_PARTITION`), `deployments/hedera-testnet/newBlr-2026-06-12T11-19-42-198.json` (`configurations.bond.configId`) |
| `src/IATSFactory.sol` | structs, `deployBond`, errors, `BondDeployed` | `factory/IFactory.sol`; `facets/core/ICore.sol` (`ERC20MetadataInfo`); `infrastructure/proxy/IResolverProxy.sol` (`Rbac`); `constants/regulation.sol` (`AdditionalSecurityData`, `FactoryRegulationData`, `RegulationType`, `RegulationSubType`) |
| `src/IATSAdmin.sol` | admin / issuance calls used by `CreateBond.s.sol` and `Deploy.s.sol` | `facets/accessControl/IAccessControl.sol`; `facets/ssiManagement/ISsiManagement.sol`; `facets/kyc/IKyc.sol`; `facets/mint/IMint.sol`; `facets/freeze/IFreeze.sol`; `facets/pause/IPause.sol`; `facets/fixedRate/IFixedRate.sol`; `facets/maturity/IMaturity.sol` |
| `../contracts/src/interfaces/IATSBond.sol` | runtime surface used by the Bond Desk contracts | `facets/compliance/IComplianceFacet.sol` (`canTransferFrom`); `facets/snapshot/ISnapshots.sol` (`takeSnapshot`); `facets/balanceTrackerAtSnapshot/IBalanceTrackerAtSnapshot.sol` (`balanceOfAtSnapshot`, `totalSupplyAtSnapshot`); `facets/pause/IPause.sol`; `facets/freeze/IFreeze.sol`; `facets/kyc/IKyc.sol`; `facets/maturity/IMaturity.sol`; `facets/transfer/ITransfer.sol`; `facets/allowance/IAllowanceTypes.sol` |
| `testnet.json` | factory / BLR proxies, bond config id + version; `bond` is filled by `script/CreateBond.s.sol` | `deployments/hedera-testnet/newBlr-2026-06-12T11-19-42-198.json` |

ABI flattening (encoding and selectors unchanged): `IBusinessLogicResolver` → `address`; `RegulationType` / `RegulationSubType` / `KycStatus` enums → `uint8`; `ICore.ERC20MetadataInfo` and `IResolverProxy.Rbac` inlined into `IATSFactory`. `contracts/test/mocks/MockATSBond.t.sol` asserts the resulting `deployBond` selector (`0x29002951`), the role hashes and the error selectors.

## Semantics reproduced by `contracts/src/mocks/MockATSBond.sol`

`canTransferFrom` (`facets/compliance/Compliance.sol` → `domain/asset/ERC1594StorageWrapper.sol::isAbleToTransferFromByPartition`) returns `(false, code, bytes32(errorSelector))` on the first failing check, in this order:

| Check | EIP-1066 | Reason selector | Declared in |
|---|---|---|---|
| paused | `0x42` | `IsPaused()` | `facets/pause/IPause.sol` |
| control list (mock: `setAddressFrozen`) | `0x10` | `AccountIsBlocked(address)` | `infrastructure/errors/ICommonErrors.sol` |
| KYC of `from`, then `to` | `0x10` | `InvalidKycStatus()` | `facets/kyc/IKyc.sol` |
| allowance (only when operator ≠ `from`) | `0x54` | `InsufficientAllowance(address spender, address from)` | `facets/allowance/IAllowanceTypes.sol` |
| balance | `0x54` | `InsufficientBalance(address account, uint256 balance, uint256 value, bytes32 partition)` | `facets/transfer/ITransfer.sol` |
| ok | `0x01` | `0x0` | `constants/eip1066.sol` |

Other behaviour verified in source and relied on by the scripts: `grantKyc` needs `ROLE_KYC`, a `NOT_GRANTED` account, `validFrom <= validTo`, `validTo >= now` and an `_issuer` previously added through `addIssuer` (`ROLE_SSI_MANAGER`); `mint` needs `ROLE_ISSUER` or `ROLE_AGENT` and a KYC'd recipient; `takeSnapshot` needs `ROLE_SNAPSHOT` (`facets/snapshot/Snapshots.sol`); `fullRedeemAtMaturity` needs `ROLE_MATURITY_REDEEMER`, a KYC'd holder and `now >= getMaturityDate()`, then burns every partition balance (`facets/maturity/Maturity.sol`).

## Testnet (chain 296)

| Item | Value |
|---|---|
| Factory proxy | `0xd1F118A40f3b02883D35909eF2517e7EDd78379d` (0.0.9213391) |
| BusinessLogicResolver proxy | `0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a` (0.0.9212226) |
| Config ids (all version 1) | equity `0x…01`, **bond `0x…02` (used)**, bondFixedRate `0x…03`, bondKpiLinkedRate `0x…04`, depositToken `0x…05`, loan `0x…06` |

`deployBond` initialises the fixed-rate facet with `{0, 0}`; the demo bond keeps ATS's rate at zero and prices coupons from `BondRegistry` terms. Scripts must guard `factory.code.length > 0 && blr.code.length > 0` before use.
