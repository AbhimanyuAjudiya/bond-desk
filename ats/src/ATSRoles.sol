// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ATS role identifiers, verbatim from packages/ats/contracts/contracts/constants/roles.sol @ be4f860e408e
// (each is keccak256("asset.tokenization.standard.role.<PascalName>"); DEFAULT_ADMIN_ROLE keeps the OZ shape).
bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;
bytes32 constant ROLE_ISSUER = 0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f;
bytes32 constant ROLE_AGENT = 0x9830aa071a741c08855dd42130bdb0ff50f7bdf5a4b72f12181eefded0c6542b;
bytes32 constant ROLE_KYC = 0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc;
bytes32 constant ROLE_SSI_MANAGER = 0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1;
bytes32 constant ROLE_SNAPSHOT = 0xf7d999723d2160432933a2aeffaae83e262a5a46fe94f34614a7676d1d1f67c6;
bytes32 constant ROLE_FREEZE_MANAGER = 0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155;
bytes32 constant ROLE_PAUSER = 0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f;
bytes32 constant ROLE_CONTROLLER = 0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e;
bytes32 constant ROLE_CORPORATE_ACTION = 0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd;
bytes32 constant ROLE_MATURITY_REDEEMER = 0x433f48f8aca23480f6ab07666cbc9131d32a0b4672033453f65e18f4dd390523;
bytes32 constant ROLE_INTEREST_RATE_MANAGER = 0xfa80c71f8de1628faf2c0e9bd02c2f4a3da1f16823b75e61e84b90164a07b4a4;

// deployments/hedera-testnet/newBlr-2026-06-12T11-19-42-198.json -> configurations.bond.configId (version 1)
bytes32 constant BOND_CONFIG_ID = bytes32(uint256(2));
// constants/values.sol -> _DEFAULT_PARTITION
bytes32 constant DEFAULT_PARTITION = bytes32(uint256(1));
