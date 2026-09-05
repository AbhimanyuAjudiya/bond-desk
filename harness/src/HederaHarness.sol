// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IHederaScheduleService} from "./interfaces/IHederaScheduleService.sol";
import {IHederaTokenService} from "./interfaces/IHederaTokenService.sol";

/// @notice Thin wrappers over the Hedera system contracts (HSS 0x16b, HTS 0x167) plus the constants
///         a contract needs to talk to them. Internal functions run in the calling contract's context:
///         the caller is the HSS payer and must hold HBAR for future executions.
library HederaHarness {
    IHederaScheduleService internal constant HSS = IHederaScheduleService(address(0x16b));
    IHederaTokenService internal constant HTS = IHederaTokenService(address(0x167));

    uint256 internal constant CHAIN_MAINNET = 295;
    uint256 internal constant CHAIN_TESTNET = 296;
    uint256 internal constant CHAIN_PREVIEWNET = 297;
    uint256 internal constant CHAIN_LOCAL = 298;

    // HederaResponseCodes (`@hiero-ledger/hiero-contracts@0.2.0`)
    int64 internal constant SUCCESS = 22;
    int64 internal constant INVALID_CONTRACT_ID = 16;
    int64 internal constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194;
    int64 internal constant INVALID_SCHEDULE_ID = 201;
    int64 internal constant SCHEDULE_ALREADY_DELETED = 212;
    int64 internal constant SCHEDULE_ALREADY_EXECUTED = 213;
    int64 internal constant SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE = 306;
    int64 internal constant SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME = 307;
    int64 internal constant SCHEDULE_EXPIRY_IS_BUSY = 370;
    int64 internal constant NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION = 373;

    /// @notice HSS accepts expiry seconds in (now, now + 62 days].
    uint256 internal constant MAX_SCHEDULE_AHEAD = 62 days;
    /// @notice The Hedera EVM denominates `msg.value` and balances in tinybar.
    uint256 internal constant TINYBAR = 1e8;
    /// @notice The JSON-RPC relay accepts 18-decimal wei; 1 tinybar = 1e10 weibar.
    uint256 internal constant WEIBAR_PER_TINYBAR = 1e10;

    /// @dev Probe windows are 2^i seconds wide; past 2^62 the maths is meaningless and `1 << i` would hit zero.
    uint256 private constant MAX_PROBES = 62;

    function ok(int64 rc) internal pure returns (bool) {
        return rc == SUCCESS;
    }

    /// @notice Schedule `data` against `to` at second `when` with no value attached.
    function schedule(address to, uint256 when, uint256 gas, bytes memory data)
        internal
        returns (address sched, int64 rc)
    {
        (rc, sched) = HSS.scheduleCall(to, when, gas, 0, data);
    }

    function hasCapacity(uint256 when, uint256 gas) internal view returns (bool) {
        return HSS.hasScheduleCapacity(when, gas);
    }

    /// @notice HIP-1215 capacity probing: try `when`, then exponential back-off windows with jitter.
    ///         Probe i checks `when + 2^i + jitter`, jitter in [0, 2^i). Never reverts; `found` is false
    ///         when every probe was busy (prevrandao may be 0, which degrades to plain back-off).
    function findAvailableSecond(uint256 when, uint256 gas, uint256 maxProbes)
        internal
        view
        returns (uint256 second, bool found)
    {
        if (HSS.hasScheduleCapacity(when, gas)) return (when, true);
        if (maxProbes > MAX_PROBES) maxProbes = MAX_PROBES;
        uint256 seed = block.prevrandao;
        for (uint256 i = 0; i < maxProbes; ++i) {
            // forge-lint: disable-next-line(incorrect-shift)
            uint256 base = 1 << i;
            uint256 jitter = uint16(uint256(keccak256(abi.encodePacked(seed, i)))) % base;
            uint256 candidate = when + base + jitter;
            if (HSS.hasScheduleCapacity(candidate, gas)) return (candidate, true);
        }
        return (0, false);
    }

    /// @notice `schedule` at the first second with capacity at or after `when`.
    /// @return sched schedule address (zero when nothing was scheduled)
    /// @return rc SCHEDULE_EXPIRY_IS_BUSY when no probe found capacity, otherwise the HSS response code
    /// @return actualWhen the second actually scheduled (zero when nothing was scheduled)
    function scheduleWithProbe(address to, uint256 when, uint256 gas, bytes memory data, uint256 maxProbes)
        internal
        returns (address sched, int64 rc, uint256 actualWhen)
    {
        (uint256 second, bool found) = findAvailableSecond(when, gas, maxProbes);
        if (!found) return (address(0), SCHEDULE_EXPIRY_IS_BUSY, 0);
        (rc, sched) = HSS.scheduleCall(to, second, gas, 0, data);
        actualWhen = ok(rc) ? second : 0;
    }

    function deleteSchedule(address sched) internal returns (int64 rc) {
        return HSS.deleteSchedule(sched);
    }

    /// @notice Associate the calling contract with `token`; already-associated counts as success.
    function associate(address token) internal returns (int64 rc) {
        rc = HTS.associateToken(address(this), token);
        if (rc == TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT) rc = SUCCESS;
    }

    /// @notice Transfer `amount` of `token` from the calling contract to `to`.
    function htsTransfer(address token, address to, int64 amount) internal returns (int64 rc) {
        return HTS.transferToken(token, address(this), to, amount);
    }
}
