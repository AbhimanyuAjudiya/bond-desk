// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHederaTokenService} from "../interfaces/IHederaTokenService.sol";

/// @notice Test double for the Hedera Token Service, meant to be `vm.etch`ed at 0x167.
/// @dev Etching installs runtime code only: no constructor runs, so every storage default here is zero-valued.
///      Balances are not tracked; transfers are recorded so tests can assert on them.
contract MockHTS is IHederaTokenService {
    struct Transfer {
        address token;
        address from;
        address to;
        uint256 amount;
    }

    int64 internal constant SUCCESS = 22;
    int64 internal constant TOKEN_NOT_ASSOCIATED_TO_ACCOUNT = 184;
    int64 internal constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194;

    /// @notice account => token => associated
    mapping(address => mapping(address => bool)) public associated;
    Transfer[] public transfers;

    function associateToken(address account, address token) external returns (int64) {
        if (associated[account][token]) return TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT;
        associated[account][token] = true;
        return SUCCESS;
    }

    function transferToken(address token, address sender, address recipient, int64 amount) external returns (int64) {
        // HTS rejects negative amounts; the mock only records, so the cast is safe for every valid input.
        // forge-lint: disable-next-line(unsafe-typecast)
        return _transfer(token, sender, recipient, uint256(uint64(amount)));
    }

    function transferFrom(address token, address from, address to, uint256 amount) external returns (int64) {
        return _transfer(token, from, to, amount);
    }

    function transferCount() external view returns (uint256) {
        return transfers.length;
    }

    function _transfer(address token, address from, address to, uint256 amount) internal returns (int64) {
        if (!associated[to][token]) return TOKEN_NOT_ASSOCIATED_TO_ACCOUNT;
        transfers.push(Transfer({token: token, from: from, to: to, amount: amount}));
        return SUCCESS;
    }
}
