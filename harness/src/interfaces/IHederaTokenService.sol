// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ABI-exact subset of `IHederaTokenService` (hiero-contracts 0.2.0),
///         the Hedera Token Service system contract at address 0x167.
/// @dev Returns `HederaResponseCodes` values (22 = SUCCESS) instead of reverting.
interface IHederaTokenService {
    /// @notice Associate `token` with `account` (required before the account can hold it).
    function associateToken(address account, address token) external returns (int64 responseCode);

    /// @notice Transfer `amount` (non-negative) of a fungible `token` from `sender` to `recipient`.
    function transferToken(address token, address sender, address recipient, int64 amount)
        external
        returns (int64 responseCode);

    /// @notice ERC-20 style allowance transfer of a fungible `token`.
    function transferFrom(address token, address from, address to, uint256 amount)
        external
        returns (int64 responseCode);
}
