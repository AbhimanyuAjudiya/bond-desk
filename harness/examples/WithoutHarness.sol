// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Every project re-declares the system-contract subset it needs.
interface IHSS {
    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData)
        external
        returns (int64 responseCode, address scheduleAddress);
    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool hasCapacity);
}

/// @notice Self-scheduling ping without the harness: the interface, the constants, the HIP-1215 probe
///         and the response-code decoding all live in the contract.
contract PingWithoutHarness {
    address internal constant HSS = address(0x16b);
    uint256 public constant GAS = 2_000_000;
    uint256 internal constant MAX_AHEAD = 62 days;
    uint256 internal constant MAX_PROBES = 8;

    int64 internal constant SUCCESS = 22;
    int64 internal constant INVALID_CONTRACT_ID = 16;
    int64 internal constant SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE = 306;
    int64 internal constant SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME = 307;
    int64 internal constant SCHEDULE_EXPIRY_IS_BUSY = 370;
    int64 internal constant NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION = 373;

    uint256 public pings;

    event Pinged(uint256 at);
    event Scheduled(address schedule, uint256 when);

    error ExpiryInPast(uint256 when);
    error ExpiryTooFar(uint256 when);
    error ScheduleFailed(int64 rc, string reason);

    receive() external payable {}

    function ping() external {
        pings++;
        emit Pinged(block.timestamp);
    }

    /// @notice Schedule `ping()` at the first free second at or after `when`.
    function schedulePing(uint256 when) external returns (address sched, uint256 actual) {
        if (when <= block.timestamp) revert ExpiryInPast(when);
        if (when > block.timestamp + MAX_AHEAD) revert ExpiryTooFar(when);

        bool found;
        (actual, found) = _findAvailableSecond(when);
        if (!found) revert ScheduleFailed(SCHEDULE_EXPIRY_IS_BUSY, _describe(SCHEDULE_EXPIRY_IS_BUSY));

        int64 rc;
        (rc, sched) = IHSS(HSS).scheduleCall(address(this), actual, GAS, 0, abi.encodeCall(this.ping, ()));
        if (rc != SUCCESS) revert ScheduleFailed(rc, _describe(rc));
        emit Scheduled(sched, actual);
    }

    /// @dev HIP-1215 back-off: probe i checks when + 2^i + jitter, jitter in [0, 2^i).
    function _findAvailableSecond(uint256 when) internal view returns (uint256, bool) {
        if (IHSS(HSS).hasScheduleCapacity(when, GAS)) return (when, true);
        uint256 seed = block.prevrandao;
        for (uint256 i = 0; i < MAX_PROBES; ++i) {
            // forge-lint: disable-next-line(incorrect-shift)
            uint256 base = 1 << i;
            uint256 jitter = uint16(uint256(keccak256(abi.encodePacked(seed, i)))) % base;
            uint256 candidate = when + base + jitter;
            if (IHSS(HSS).hasScheduleCapacity(candidate, GAS)) return (candidate, true);
        }
        return (0, false);
    }

    function _describe(int64 rc) internal pure returns (string memory) {
        if (rc == INVALID_CONTRACT_ID) return "INVALID_CONTRACT_ID";
        if (rc == SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE) return "SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE";
        if (rc == SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME) {
            return "SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME";
        }
        if (rc == SCHEDULE_EXPIRY_IS_BUSY) return "SCHEDULE_EXPIRY_IS_BUSY";
        if (rc == NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION) {
            return "NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION";
        }
        return "UNKNOWN";
    }
}
