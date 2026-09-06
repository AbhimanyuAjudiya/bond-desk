// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Single source of truth for bond terms, lifecycle status and Bond Desk roles.
contract BondRegistry is AccessControl {
    enum Status {
        None,
        Active,
        Frozen,
        Matured,
        Defaulted
    }

    struct BondTerms {
        address token;
        address settlement;
        address issuer;
        uint8 bondDecimals;
        uint8 settlementDecimals;
        uint256 faceValue;
        uint256 couponRateBps;
        uint64 couponInterval;
        uint64 nextCoupon;
        uint64 maturity;
        Status status;
    }

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant GATE_ROLE = keccak256("GATE_ROLE");

    uint256 public bondCount;
    mapping(uint256 => BondTerms) internal _terms;

    event BondRegistered(uint256 indexed bondId, address indexed token, address indexed issuer, address settlement);
    event StatusChanged(uint256 indexed bondId, Status from, Status to);
    event NextCouponSet(uint256 indexed bondId, uint64 nextCoupon);

    error UnknownBond(uint256 bondId);
    error InvalidTerms();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Registers a bond; msg.sender becomes its issuer. Ids are 1..bondCount. Decimals are read from both tokens.
    function register(
        address token,
        address settlement,
        uint256 faceValue,
        uint256 couponRateBps,
        uint64 couponInterval,
        uint64 firstCoupon,
        uint64 maturity
    ) external onlyRole(ISSUER_ROLE) returns (uint256 bondId) {
        if (
            token == address(0) || settlement == address(0) || faceValue == 0 || couponInterval == 0
                || firstCoupon > maturity || maturity <= block.timestamp || couponRateBps > 10_000
        ) revert InvalidTerms();
        bondId = ++bondCount;
        _terms[bondId] = BondTerms({
            token: token,
            settlement: settlement,
            issuer: msg.sender,
            bondDecimals: IERC20Metadata(token).decimals(),
            settlementDecimals: IERC20Metadata(settlement).decimals(),
            faceValue: faceValue,
            couponRateBps: couponRateBps,
            couponInterval: couponInterval,
            nextCoupon: firstCoupon,
            maturity: maturity,
            status: Status.Active
        });
        emit BondRegistered(bondId, token, msg.sender, settlement);
    }

    /// @notice Full terms; reverts UnknownBond for ids outside 1..bondCount.
    function terms(uint256 bondId) external view returns (BondTerms memory) {
        _checkKnown(bondId);
        return _terms[bondId];
    }

    /// @notice Status; None for unknown ids (never reverts).
    function status(uint256 bondId) external view returns (Status) {
        return _terms[bondId].status;
    }

    function setStatus(uint256 bondId, Status to) external onlyRole(GATE_ROLE) {
        _checkKnown(bondId);
        emit StatusChanged(bondId, _terms[bondId].status, to);
        _terms[bondId].status = to;
    }

    function setNextCoupon(uint256 bondId, uint64 nextCoupon) external onlyRole(GATE_ROLE) {
        _checkKnown(bondId);
        _terms[bondId].nextCoupon = nextCoupon;
        emit NextCouponSet(bondId, nextCoupon);
    }

    function isAdmin(address account) external view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account);
    }

    function isIssuer(uint256 bondId, address account) external view returns (bool) {
        return account != address(0) && _terms[bondId].issuer == account;
    }

    function _checkKnown(uint256 bondId) internal view {
        if (bondId == 0 || bondId > bondCount) revert UnknownBond(bondId);
    }
}
