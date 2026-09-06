// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BondRegistry} from "./BondRegistry.sol";
import {RegistryAuth} from "./RegistryAuth.sol";
import {NavOracle} from "./NavOracle.sol";
import {IATSBond} from "./interfaces/IATSBond.sol";

/// @notice Per-bond native HBAR collateral (tinybar), coverage vs outstanding principal, and pro-rata
///         distribution to token holders after a DEFAULT seizure (ATS snapshot at seizure time).
/// @dev Must hold ROLE_SNAPSHOT on the ATS token. ATS `takeSnapshot` is `onlyUnpaused`: seize fails on a paused token.
contract CollateralVault is RegistryAuth, ReentrancyGuard {
    struct Seizure {
        uint256 snapshotId;
        uint256 amount;
    }

    uint8 public constant NATIVE_DECIMALS = 8; // Hedera EVM: msg.value in tinybar
    uint256 public minCoverageBps;
    NavOracle public immutable oracle;

    mapping(uint256 => uint256) public collateral;
    mapping(uint256 => Seizure) public seizures;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event Deposited(uint256 indexed bondId, address indexed from, uint256 amount);
    event Withdrawn(uint256 indexed bondId, address indexed to, uint256 amount);
    event Seized(uint256 indexed bondId, uint256 snapshotId, uint256 amount);
    event SeizedClaimed(uint256 indexed bondId, address indexed holder, uint256 amount);
    event MinCoverageSet(uint256 bps);

    error BadStatus(BondRegistry.Status s);
    error CoverageTooLow(uint256 afterBps, uint256 minBps);
    error DirectDepositNotAllowed();
    error BadAmount();
    error AlreadySeized();
    error NotSeized();
    error AlreadyClaimed();
    error NothingToClaim();
    error SendFailed();

    constructor(BondRegistry registry_, NavOracle oracle_, uint256 minCoverageBps_) RegistryAuth(registry_) {
        oracle = oracle_;
        minCoverageBps = minCoverageBps_;
    }

    /// @dev Collateral is always attributed to a bond via `deposit`.
    receive() external payable {
        revert DirectDepositNotAllowed();
    }

    /// @notice Issuer posts collateral; allowed while Active or Frozen (topping up is how a freeze gets lifted).
    function deposit(uint256 bondId) external payable onlyIssuer(bondId) {
        BondRegistry.Status s = registry.status(bondId);
        if (s != BondRegistry.Status.Active && s != BondRegistry.Status.Frozen) revert BadStatus(s);
        if (msg.value == 0) revert BadAmount();
        collateral[bondId] += msg.value;
        emit Deposited(bondId, msg.sender, msg.value);
    }

    /// @notice Issuer withdraws collateral while Active or Matured, keeping coverage >= minCoverageBps.
    function withdraw(uint256 bondId, uint256 amount) external onlyIssuer(bondId) nonReentrant {
        BondRegistry.Status s = registry.status(bondId);
        if (s != BondRegistry.Status.Active && s != BondRegistry.Status.Matured) revert BadStatus(s);
        if (seizures[bondId].snapshotId != 0) revert AlreadySeized();
        if (amount == 0 || amount > collateral[bondId]) revert BadAmount();
        collateral[bondId] -= amount;
        uint256 cov = coverageBps(bondId);
        if (cov < minCoverageBps) revert CoverageTooLow(cov, minCoverageBps);
        emit Withdrawn(bondId, msg.sender, amount);
        _send(msg.sender, amount);
    }

    /// @notice Collateral value / outstanding principal, in bps; max when nothing is outstanding.
    ///         Always reads the feed, so a stale round reverts (NavOracle.StaleFeed) and RiskGate.snapshot's
    ///         `feedFresh` stays honest.
    function coverageBps(uint256 bondId) public view returns (uint256) {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        // tinybar (1e8) * price8 (1e8) -> settlement units
        uint256 collateralUsd = collateral[bondId] * oracle.hbarUsd() * 10 ** t.settlementDecimals / 1e16;
        uint256 principalUsd = IATSBond(t.token).totalSupply() * t.faceValue / 10 ** t.bondDecimals;
        return principalUsd == 0 ? type(uint256).max : collateralUsd * 10_000 / principalUsd;
    }

    /// @notice Gate (RiskGate on DEFAULT) snapshots holders and locks the whole collateral for pro-rata claims.
    function seize(uint256 bondId) external onlyGate {
        if (seizures[bondId].snapshotId != 0) revert AlreadySeized();
        uint256 snapshotId = IATSBond(registry.terms(bondId).token).takeSnapshot();
        uint256 amount = collateral[bondId];
        seizures[bondId] = Seizure(snapshotId, amount);
        collateral[bondId] = 0;
        emit Seized(bondId, snapshotId, amount);
    }

    /// @notice Holder at the seizure snapshot claims `amount * balance / supply` once.
    function claimSeized(uint256 bondId) external nonReentrant {
        Seizure memory z = seizures[bondId];
        if (z.snapshotId == 0) revert NotSeized();
        if (claimed[bondId][msg.sender]) revert AlreadyClaimed();
        IATSBond token = IATSBond(registry.terms(bondId).token);
        uint256 supply = token.totalSupplyAtSnapshot(z.snapshotId);
        uint256 share = supply == 0 ? 0 : z.amount * token.balanceOfAtSnapshot(z.snapshotId, msg.sender) / supply;
        if (share == 0) revert NothingToClaim();
        claimed[bondId][msg.sender] = true;
        emit SeizedClaimed(bondId, msg.sender, share);
        _send(msg.sender, share);
    }

    function setMinCoverage(uint256 bps) external onlyAdmin {
        minCoverageBps = bps;
        emit MinCoverageSet(bps);
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert SendFailed();
    }
}
