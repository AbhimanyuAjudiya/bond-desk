// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHederaScheduleService} from "../interfaces/IHederaScheduleService.sol";

/// @notice Test double for the Hedera Schedule Service (HIP-1215), meant to be `vm.etch`ed at 0x16b.
/// @dev Etching installs runtime code only: no constructor runs, so every storage default here is zero-valued.
///      Response codes follow `HederaResponseCodes` from hiero-contracts 0.2.0.
contract MockHSS is IHederaScheduleService {
    struct Scheduled {
        address to;
        uint256 when;
        uint256 gas;
        uint64 value;
        bytes data;
        address creator;
        bool executed;
        bool deleted;
    }

    int64 internal constant SUCCESS = 22;
    int64 internal constant INVALID_CONTRACT_ID = 16;
    int64 internal constant INVALID_SCHEDULE_ID = 201;
    int64 internal constant SCHEDULE_ALREADY_DELETED = 212;
    int64 internal constant SCHEDULE_ALREADY_EXECUTED = 213;
    int64 internal constant SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE = 306;
    int64 internal constant SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME = 307;
    int64 internal constant SCHEDULE_EXPIRY_IS_BUSY = 370;
    int64 internal constant NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION = 373;

    uint256 internal constant MAX_AHEAD = 62 days;
    /// @dev Schedule entities are long-zero addresses on Hedera; this base keeps mock ids recognisable.
    uint160 internal constant ADDRESS_BASE = 0x5c4ed000;

    Scheduled[] public schedules;
    /// @notice schedule address => index + 1 (0 = unknown); the address itself is `addressOf(index)`
    mapping(address => uint256) public idOf;
    /// @notice seconds that report no capacity (simulates a full throttle bucket)
    mapping(uint256 => bool) public busy;
    /// @notice when set, every second reports no capacity
    bool public noCapacity;
    /// @notice when set, scheduling from inside a scheduled execution returns 373
    bool public blockNested;
    bool internal _executing;

    event Executed(address indexed schedule, bool success, bytes result);

    error UnknownSchedule(address schedule);
    error NotPending(address schedule);

    // ---- IHederaScheduleService ----

    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData)
        external
        returns (int64, address)
    {
        return _schedule(to, expirySecond, gasLimit, value, callData);
    }

    function scheduleCallWithPayer(
        address to,
        address,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64, address) {
        return _schedule(to, expirySecond, gasLimit, value, callData);
    }

    function deleteSchedule(address scheduleAddress) external returns (int64) {
        uint256 id = idOf[scheduleAddress];
        if (id == 0) return INVALID_SCHEDULE_ID;
        Scheduled storage s = schedules[id - 1];
        if (s.executed) return SCHEDULE_ALREADY_EXECUTED;
        if (s.deleted) return SCHEDULE_ALREADY_DELETED;
        s.deleted = true;
        return SUCCESS;
    }

    function hasScheduleCapacity(uint256 expirySecond, uint256) external view returns (bool) {
        return !noCapacity && !busy[expirySecond] && expirySecond > block.timestamp
            && expirySecond <= block.timestamp + MAX_AHEAD;
    }

    // ---- test helpers ----

    /// @notice Fire every pending schedule whose second has been reached (call after `vm.warp`).
    function executeDue() external {
        uint256 n = schedules.length;
        for (uint256 i = 0; i < n; ++i) {
            Scheduled storage s = schedules[i];
            if (!s.executed && !s.deleted && s.when <= block.timestamp) _fire(i);
        }
    }

    /// @notice Fire one pending schedule regardless of the current time.
    function execute(address scheduleAddress) external {
        uint256 id = idOf[scheduleAddress];
        if (id == 0) revert UnknownSchedule(scheduleAddress);
        Scheduled storage s = schedules[id - 1];
        if (s.executed || s.deleted) revert NotPending(scheduleAddress);
        _fire(id - 1);
    }

    function count() external view returns (uint256) {
        return schedules.length;
    }

    function get(address scheduleAddress) external view returns (Scheduled memory) {
        uint256 id = idOf[scheduleAddress];
        if (id == 0) revert UnknownSchedule(scheduleAddress);
        return schedules[id - 1];
    }

    function setNoCapacity(bool v) external {
        noCapacity = v;
    }

    function setBusy(uint256 second, bool v) external {
        busy[second] = v;
    }

    function setBlockNested(bool v) external {
        blockNested = v;
    }

    /// @notice Address of the schedule at `index` (0-based, so the first one is 0x5c4ed000).
    function addressOf(uint256 index) public pure returns (address) {
        // indices are array positions, far below 2^160
        // forge-lint: disable-next-line(unsafe-typecast)
        return address(ADDRESS_BASE + uint160(index));
    }

    // ---- internals ----

    function _schedule(address to, uint256 when, uint256 gas, uint64 value, bytes memory data)
        internal
        returns (int64, address)
    {
        if (to == address(0)) return (INVALID_CONTRACT_ID, address(0));
        if (when <= block.timestamp) return (SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME, address(0));
        if (when > block.timestamp + MAX_AHEAD) return (SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE, address(0));
        if (_executing && blockNested) return (NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION, address(0));
        if (noCapacity || busy[when]) return (SCHEDULE_EXPIRY_IS_BUSY, address(0));

        uint256 id = schedules.length;
        address sched = addressOf(id);
        schedules.push(
            Scheduled({
                to: to,
                when: when,
                gas: gas,
                value: value,
                data: data,
                creator: msg.sender,
                executed: false,
                deleted: false
            })
        );
        idOf[sched] = id + 1;
        return (SUCCESS, sched);
    }

    function _fire(uint256 i) internal {
        Scheduled storage s = schedules[i];
        s.executed = true;
        _executing = true;
        (bool success, bytes memory result) = s.to.call{gas: s.gas}(s.data);
        _executing = false;
        emit Executed(addressOf(i), success, result);
    }
}
