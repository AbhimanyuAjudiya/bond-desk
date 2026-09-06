// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ABI-exact subset of the ATS bond diamond (tag v.8.0.0-ats, commit be4f860e408e) used at runtime by Bond Desk.
/// @dev Provenance per function is listed in ats/README.md. `getKycStatusFor` returns the `IKyc.KycStatus` enum (uint8).
interface IATSBond {
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function canTransferFrom(address from, address to, uint256 value, bytes calldata data)
        external
        view
        returns (bool ok, bytes1 code, bytes32 reason);
    function takeSnapshot() external returns (uint256 snapshotId);
    function balanceOfAtSnapshot(uint256 snapshotId, address holder) external view returns (uint256);
    function totalSupplyAtSnapshot(uint256 snapshotId) external view returns (uint256);
    function paused() external view returns (bool);
    function isFrozen(address) external view returns (bool);
    function getKycStatusFor(address) external view returns (uint8); // 0 NOT_GRANTED, 1 GRANTED
    function fullRedeemAtMaturity(address holder) external;
    function getMaturityDate() external view returns (uint256);
}
