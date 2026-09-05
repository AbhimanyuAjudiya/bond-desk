// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HederaHarness} from "hedera-harness/HederaHarness.sol";

/// @notice Self-scheduling ping using the harness: capacity probing and response-code handling are one call.
contract PingWithHarness {
    uint256 public constant GAS = 2_000_000;
    uint256 public pings;

    event Pinged(uint256 at);
    event Scheduled(address schedule, uint256 when);

    error ScheduleFailed(int64 rc);

    /// @dev The contract pays for its own scheduled executions, so it must hold HBAR.
    receive() external payable {}

    function ping() external {
        pings++;
        emit Pinged(block.timestamp);
    }

    /// @notice Schedule `ping()` at the first free second at or after `when`.
    function schedulePing(uint256 when) external returns (address sched, uint256 actual) {
        int64 rc;
        (sched, rc, actual) =
            HederaHarness.scheduleWithProbe(address(this), when, GAS, abi.encodeCall(this.ping, ()), 8);
        require(HederaHarness.ok(rc), ScheduleFailed(rc));
        emit Scheduled(sched, actual);
    }
}
