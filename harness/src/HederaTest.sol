// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HederaHarness} from "./HederaHarness.sol";
import {MockHSS} from "./mocks/MockHSS.sol";
import {MockHTS} from "./mocks/MockHTS.sol";

/// @notice Base test: installs mock HSS/HTS at the real system-contract addresses so contracts under test
///         run unchanged, and drives scheduled executions with `warpAndExecute`.
abstract contract HederaTest is Test {
    MockHSS internal hss;
    MockHTS internal hts;

    function setUp() public virtual {
        installHedera();
    }

    /// @notice Etch the mocks at 0x16b / 0x167 (runtime code only: no constructor runs, storage starts zeroed).
    function installHedera() internal {
        vm.etch(address(HederaHarness.HSS), type(MockHSS).runtimeCode);
        vm.etch(address(HederaHarness.HTS), type(MockHTS).runtimeCode);
        hss = MockHSS(address(HederaHarness.HSS));
        hts = MockHTS(address(HederaHarness.HTS));
        vm.label(address(hss), "HSS(0x16b)");
        vm.label(address(hts), "HTS(0x167)");
    }

    /// @notice Fire every schedule whose second is <= block.timestamp.
    function executeDueSchedules() internal {
        hss.executeDue();
    }

    /// @notice Warp to `t` then fire due schedules, as the network would.
    function warpAndExecute(uint256 t) internal {
        vm.warp(t);
        hss.executeDue();
    }

    /// @notice Fire `sched` as the network does: at its expiry second, inside a block that started `lag` seconds
    ///         earlier. `block.timestamp` is the block's start (~2 s behind on testnet), so a call gated on
    ///         `block.timestamp >= due` must be scheduled at `due + lag` to survive this.
    function executeLagged(address sched, uint256 lag) internal {
        vm.warp(hss.get(sched).when - lag);
        hss.execute(sched);
    }

    /// @notice Whole HBAR in tinybar, the unit the Hedera EVM uses for `msg.value`.
    function hbar(uint256 whole) internal pure returns (uint256) {
        return whole * HederaHarness.TINYBAR;
    }
}
