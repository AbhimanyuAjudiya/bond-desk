// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ABI-exact admin / issuance subset of the ATS bond diamond used by the deploy and demo scripts.
/// @dev Provenance (packages/ats/contracts/contracts @ be4f860e408e): facets/accessControl/IAccessControl.sol,
///      facets/ssiManagement/ISsiManagement.sol, facets/kyc/IKyc.sol (`KycStatus` enum -> uint8: 0 NOT_GRANTED,
///      1 GRANTED), facets/mint/IMint.sol, facets/freeze/IFreeze.sol, facets/pause/IPause.sol,
///      facets/fixedRate/IFixedRate.sol, facets/maturity/IMaturity.sol, ERC-20 views.
interface IATSAdmin {
    function grantRole(bytes32 role, address account) external returns (bool);
    function revokeRole(bytes32 role, address account) external returns (bool);
    function hasRole(bytes32 role, address account) external view returns (bool);
    function addIssuer(address issuer) external returns (bool);
    function isIssuer(address issuer) external view returns (bool);
    function grantKyc(address account, string calldata vcId, uint256 validFrom, uint256 validTo, address issuer)
        external
        returns (bool);
    function revokeKyc(address account) external returns (bool);
    function getKycStatusFor(address account) external view returns (uint8);
    function mint(address to, uint256 amount) external;
    function setAddressFrozen(address account, bool freezeStatus) external;
    function pause() external returns (bool);
    function unpause() external returns (bool);
    function paused() external view returns (bool);
    function setRate(uint256 rate, uint8 rateDecimals) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function getMaturityDate() external view returns (uint256);
}
