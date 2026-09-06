// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondRegistry} from "./BondRegistry.sol";

/// @notice Role checks delegated to the BondRegistry's AccessControl (one role store for the whole desk).
abstract contract RegistryAuth {
    BondRegistry public immutable registry;

    error NotAdmin();
    error NotIssuer();
    error NotGate();

    constructor(BondRegistry r) {
        registry = r;
    }

    modifier onlyAdmin() {
        if (!registry.isAdmin(msg.sender)) revert NotAdmin();
        _;
    }

    modifier onlyIssuer(uint256 bondId) {
        if (!registry.isIssuer(bondId, msg.sender)) revert NotIssuer();
        _;
    }

    modifier onlyGate() {
        if (!registry.hasRole(registry.GATE_ROLE(), msg.sender)) revert NotGate();
        _;
    }
}
