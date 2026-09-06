// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 with ATS-shaped compliance, lazy snapshots and the admin surface Bond Desk relies on.
/// @dev ABI-compatible with IATSBond and IATSAdmin (asserted in contracts/test/mocks/MockATSBond.t.sol).
///      Error names/params mirror ATS v.8.0.0-ats so selectors match the live token (IsPaused, InvalidKycStatus,
///      AccountIsBlocked, InsufficientAllowance, InsufficientBalance); NotMatured is mock-only.
///      Roles are recorded, never enforced. `frozen` stands in for the ATS control list.
contract MockATSBond is ERC20 {
    struct Checkpoint {
        uint256 id;
        uint256 value;
    }

    bytes32 public constant DEFAULT_PARTITION = bytes32(uint256(1));
    bytes1 internal constant OK = 0x01; // Eip1066.SUCCESS
    bytes1 internal constant STOP = 0x10; // Eip1066.DISALLOWED_OR_STOP
    bytes1 internal constant PAUSED = 0x42; // Eip1066.PAUSED
    bytes1 internal constant INSUFFICIENT = 0x54; // Eip1066.INSUFFICIENT_FUNDS

    error IsPaused();
    error InvalidKycStatus();
    error AccountIsBlocked(address account);
    error InsufficientAllowance(address spender, address from);
    error InsufficientBalance(address account, uint256 balance, uint256 value, bytes32 partition);
    error NotMatured();

    uint8 private immutable _decimals;
    uint256 private immutable _maturity;
    bool private _paused;
    uint256 public currentSnapshotId;
    uint256 public rate;
    uint8 public rateDecimals;
    mapping(address => bool) public kyc;
    mapping(address => bool) public frozen;
    mapping(address => bool) public issuers;
    mapping(bytes32 => mapping(address => bool)) internal _roles;
    mapping(address => Checkpoint[]) internal _balanceCps;
    Checkpoint[] internal _supplyCps;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 maturity_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
        _maturity = maturity_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // ---------------------------------------------------------------- IATSBond

    /// @dev Same order and codes as ATS `isAbleToTransferFromByPartition`; reason = bytes32(error selector).
    function canTransferFrom(address from, address to, uint256 value, bytes calldata)
        external
        view
        returns (bool, bytes1, bytes32)
    {
        if (_paused) return (false, PAUSED, bytes32(IsPaused.selector));
        if (frozen[from] || frozen[to]) return (false, STOP, bytes32(AccountIsBlocked.selector));
        if (!kyc[from] || !kyc[to]) return (false, STOP, bytes32(InvalidKycStatus.selector));
        if (msg.sender != from && allowance(from, msg.sender) < value) {
            return (false, INSUFFICIENT, bytes32(InsufficientAllowance.selector));
        }
        if (balanceOf(from) < value) return (false, INSUFFICIENT, bytes32(InsufficientBalance.selector));
        return (true, OK, bytes32(0));
    }

    function takeSnapshot() external returns (uint256) {
        return ++currentSnapshotId;
    }

    function balanceOfAtSnapshot(uint256 snapshotId, address holder) external view returns (uint256) {
        return _at(_balanceCps[holder], snapshotId, balanceOf(holder));
    }

    function totalSupplyAtSnapshot(uint256 snapshotId) external view returns (uint256) {
        return _at(_supplyCps, snapshotId, totalSupply());
    }

    function paused() external view returns (bool) {
        return _paused;
    }

    function isFrozen(address account) external view returns (bool) {
        return frozen[account];
    }

    function getKycStatusFor(address account) external view returns (uint8) {
        return kyc[account] ? 1 : 0;
    }

    function fullRedeemAtMaturity(address holder) external {
        if (block.timestamp < _maturity) revert NotMatured();
        if (!kyc[holder]) revert InvalidKycStatus();
        _burn(holder, balanceOf(holder));
    }

    function getMaturityDate() external view returns (uint256) {
        return _maturity;
    }

    // --------------------------------------------------- IATSAdmin (no role enforcement)

    function grantRole(bytes32 role, address account) external returns (bool) {
        _roles[role][account] = true;
        return true;
    }

    function revokeRole(bytes32 role, address account) external returns (bool) {
        _roles[role][account] = false;
        return true;
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    function addIssuer(address issuer) external returns (bool) {
        issuers[issuer] = true;
        return true;
    }

    function isIssuer(address issuer) external view returns (bool) {
        return issuers[issuer];
    }

    function grantKyc(address account, string calldata, uint256, uint256, address) external returns (bool) {
        kyc[account] = true;
        return true;
    }

    function revokeKyc(address account) external returns (bool) {
        kyc[account] = false;
        return true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAddressFrozen(address account, bool freezeStatus) external {
        frozen[account] = freezeStatus;
    }

    function pause() external returns (bool) {
        _paused = true;
        return true;
    }

    function unpause() external returns (bool) {
        _paused = false;
        return true;
    }

    function setRate(uint256 rate_, uint8 rateDecimals_) external {
        rate = rate_;
        rateDecimals = rateDecimals_;
    }

    // ---------------------------------------------------------------- internals

    function _spendAllowance(address owner, address spender, uint256 value) internal override {
        if (allowance(owner, spender) < value) revert InsufficientAllowance(spender, owner);
        super._spendAllowance(owner, spender, value);
    }

    /// @dev Checkpoints are written before balances move (ATS lazy snapshots). Transfers enforce the
    ///      canTransferFrom checks with the matching errors; mint checks kyc[to] only; burn is unchecked.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) _checkpoint(_balanceCps[from], balanceOf(from));
        if (to != address(0)) _checkpoint(_balanceCps[to], balanceOf(to));
        if (from == address(0) || to == address(0)) _checkpoint(_supplyCps, totalSupply());
        if (from == address(0)) {
            if (!kyc[to]) revert InvalidKycStatus();
        } else if (to != address(0)) {
            if (_paused) revert IsPaused();
            if (frozen[from]) revert AccountIsBlocked(from);
            if (frozen[to]) revert AccountIsBlocked(to);
            if (!kyc[from] || !kyc[to]) revert InvalidKycStatus();
            uint256 bal = balanceOf(from);
            if (bal < value) revert InsufficientBalance(from, bal, value, DEFAULT_PARTITION);
        }
        super._update(from, to, value);
    }

    function _checkpoint(Checkpoint[] storage cps, uint256 current) private {
        uint256 id = currentSnapshotId;
        if (id == 0) return;
        if (cps.length == 0 || cps[cps.length - 1].id < id) cps.push(Checkpoint(id, current));
    }

    // ponytail: linear scan; binary search if a holder ever accrues many checkpoints
    function _at(Checkpoint[] storage cps, uint256 snapshotId, uint256 current) private view returns (uint256) {
        for (uint256 i; i < cps.length; ++i) {
            if (cps[i].id >= snapshotId) return cps[i].value;
        }
        return current;
    }
}
