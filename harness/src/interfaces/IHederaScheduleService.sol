// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ABI-exact subset of HIP-1215 `IHRC1215` (hiero-contracts 0.2.0),
///         the Hedera Schedule Service system contract at address 0x16b.
/// @dev The system contract never reverts: it returns a `HederaResponseCodes` value (22 = SUCCESS).
interface IHederaScheduleService {
    /// @notice Schedule `callData` against `to` at consensus second `expirySecond`; the caller pays the future call.
    /// @param value tinybars sent with the future call
    function scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData)
        external
        returns (int64 responseCode, address scheduleAddress);

    /// @notice Same as `scheduleCall` but `payer` funds the future call once its key has signed the schedule.
    function scheduleCallWithPayer(
        address to,
        address payer,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress);

    /// @notice Delete a pending schedule created by the caller.
    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode);

    /// @notice True iff `expirySecond` still has throttle capacity for a call of `gasLimit`.
    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool hasCapacity);
}
