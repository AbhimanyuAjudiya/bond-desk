// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HederaHarness} from "hedera-harness/HederaHarness.sol";
import {BondRegistry} from "./BondRegistry.sol";
import {RegistryAuth} from "./RegistryAuth.sol";
import {IATSBond} from "./interfaces/IATSBond.sol";

/// @notice Coupons and principal for registered bonds: one settlement pool per bond, pull-based coupon claims
///         pro-rata to an ATS snapshot, coupon runs scheduled through the Hedera Schedule Service, redemption at maturity.
/// @dev Needs GATE_ROLE on the registry and ROLE_SNAPSHOT + ROLE_MATURITY_REDEEMER on the ATS token.
///      This contract is the HSS payer for its scheduled `payCoupon` calls: keep it funded with HBAR (`receive`).
contract BondLifecycle is RegistryAuth, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Coupon {
        uint256 snapshotId;
        uint256 amount;
        uint256 claimedTotal;
        uint64 paidAt;
    }

    uint256 public constant YEAR = 365 days;
    uint256 public constant SCHEDULE_GAS = 4_000_000; // testnet: payCoupon + nested re-schedule needs ~1.9M, HSS charges a markup
    uint256 public constant PROBE_MAX = 8;
    /// @notice Seconds added to a coupon's target when it is scheduled. HSS fires a schedule at its expiry second,
    ///         but `block.timestamp` inside that run is the start of the block it lands in, up to ~2 s earlier
    ///         (testnet coupon 2: expiry 1789121682, block 40378969 started at 1789121680, `payCoupon` reverted
    ///         CouponNotDue). Irrelevant for daily coupons, fatal without it.
    uint256 public constant SCHEDULE_LAG = 10;

    // ponytail: one pool per bond serves coupons and principal; split into two if issuers need earmarking
    mapping(uint256 => uint256) public funded;
    mapping(uint256 => uint256) public couponCount;
    mapping(uint256 => mapping(uint256 => Coupon)) public coupons;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public claimed;
    /// @notice pending HSS schedule for the next coupon (zero when none / after it fired)
    mapping(uint256 => address) public scheduleOf;
    /// @notice the coupon time `scheduleOf` was created for (armed SCHEDULE_LAG later; may slide further under load)
    mapping(uint256 => uint64) public scheduledFor;

    event Funded(uint256 indexed bondId, address indexed from, uint256 amount);
    event CouponPaid(uint256 indexed bondId, uint256 indexed couponId, uint256 snapshotId, uint256 amount, uint64 nextCoupon);
    event CouponClaimed(uint256 indexed bondId, uint256 indexed couponId, address indexed holder, uint256 amount);
    event CouponScheduled(uint256 indexed bondId, address schedule, uint256 when);
    event ScheduleFailed(uint256 indexed bondId, int64 rc);
    event ScheduleSkipped(uint256 indexed bondId, uint256 when);
    event Redeemed(uint256 indexed bondId, address indexed holder, uint256 tokens, uint256 principal);
    event HbarWithdrawn(address to, uint256 amount);

    error BadStatus(BondRegistry.Status s);
    error CouponNotDue(uint64 nextCoupon);
    error NoMoreCoupons();
    error CouponUnderfunded(uint256 due, uint256 funded);
    error NoCoupon();
    error AlreadyClaimed();
    error NothingToClaim();
    error NotMatured(uint64 maturity);
    error NothingToRedeem();
    error PrincipalUnderfunded(uint256 need, uint256 funded);
    error AlreadyScheduled();
    error SendFailed();

    constructor(BondRegistry registry_) RegistryAuth(registry_) {}

    /// @notice HSS payer float.
    receive() external payable {}

    /// @notice Pull `amount` of the bond's settlement token into its pool. Anyone may fund.
    function fund(uint256 bondId, uint256 amount) external {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        IERC20(t.settlement).safeTransferFrom(msg.sender, address(this), amount);
        funded[bondId] += amount;
        emit Funded(bondId, msg.sender, amount);
    }

    /// @notice Coupon that would be due now, against the live total supply.
    function couponDue(uint256 bondId) external view returns (uint256) {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        return _due(t, IATSBond(t.token).totalSupply());
    }

    /// @notice Snapshot holders, reserve the coupon from the pool, advance `nextCoupon` and schedule the next run.
    ///         Callable by anyone, including the HSS scheduled execution.
    function payCoupon(uint256 bondId) external nonReentrant {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        if (t.status != BondRegistry.Status.Active && t.status != BondRegistry.Status.Frozen) revert BadStatus(t.status);
        if (block.timestamp < t.nextCoupon) revert CouponNotDue(t.nextCoupon);
        if (t.nextCoupon > t.maturity) revert NoMoreCoupons();

        IATSBond token = IATSBond(t.token);
        uint256 snapshotId = token.takeSnapshot();
        uint256 due = _due(t, token.totalSupplyAtSnapshot(snapshotId));
        uint256 pool = funded[bondId];
        if (pool < due) revert CouponUnderfunded(due, pool);
        funded[bondId] = pool - due;

        uint256 couponId = ++couponCount[bondId];
        // forge-lint: disable-next-line(unsafe-typecast)
        coupons[bondId][couponId] =
            Coupon({snapshotId: snapshotId, amount: due, claimedTotal: 0, paidAt: uint64(block.timestamp)});

        uint64 next = t.nextCoupon + t.couponInterval;
        registry.setNextCoupon(bondId, next);
        // Drop a still-pending HSS run (coupon paid by hand before its second): otherwise it fires later, reverts
        // CouponNotDue and burns one execution of the HBAR float. rc ignored: 213 when this call *is* that run.
        address pending = scheduleOf[bondId];
        if (pending != address(0)) try HederaHarness.HSS.deleteSchedule(pending) {} catch {}
        delete scheduleOf[bondId];
        delete scheduledFor[bondId];
        emit CouponPaid(bondId, couponId, snapshotId, due, next);
        if (next <= t.maturity) _schedule(bondId, next);
    }

    /// @notice Claim the caller's share of coupon `couponId`.
    function claim(uint256 bondId, uint256 couponId) external nonReentrant {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        Coupon storage c = coupons[bondId][couponId];
        if (c.paidAt == 0) revert NoCoupon();
        if (claimed[bondId][couponId][msg.sender]) revert AlreadyClaimed();
        uint256 amount = _share(IATSBond(t.token), c, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[bondId][couponId][msg.sender] = true;
        c.claimedTotal += amount;
        IERC20(t.settlement).safeTransfer(msg.sender, amount);
        emit CouponClaimed(bondId, couponId, msg.sender, amount);
    }

    /// @notice Unclaimed share of `holder` in coupon `couponId` (0 when unknown or already claimed).
    function claimable(uint256 bondId, uint256 couponId, address holder) external view returns (uint256) {
        Coupon storage c = coupons[bondId][couponId];
        if (c.paidAt == 0 || claimed[bondId][couponId][holder]) return 0;
        return _share(IATSBond(registry.terms(bondId).token), c, holder);
    }

    /// @notice Permissionless (re)scheduling of the next coupon run, e.g. after a 373/370 failure.
    function schedule(uint256 bondId) external {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        if (scheduledFor[bondId] == t.nextCoupon && scheduleOf[bondId] != address(0)) revert AlreadyScheduled();
        _schedule(bondId, t.nextCoupon);
    }

    /// @notice Burn the caller's whole balance at maturity and pay principal from the pool.
    function redeem(uint256 bondId) external nonReentrant {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        if (t.status == BondRegistry.Status.Defaulted) revert BadStatus(t.status);
        if (block.timestamp < t.maturity) revert NotMatured(t.maturity);
        IATSBond token = IATSBond(t.token);
        uint256 bal = token.balanceOf(msg.sender);
        if (bal == 0) revert NothingToRedeem();
        uint256 principal = bal * t.faceValue / 10 ** t.bondDecimals;
        uint256 pool = funded[bondId];
        if (pool < principal) revert PrincipalUnderfunded(principal, pool);
        funded[bondId] = pool - principal;
        token.fullRedeemAtMaturity(msg.sender);
        IERC20(t.settlement).safeTransfer(msg.sender, principal);
        if (t.status != BondRegistry.Status.Matured) registry.setStatus(bondId, BondRegistry.Status.Matured);
        emit Redeemed(bondId, msg.sender, bal, principal);
    }

    /// @notice Recover HBAR from the payer float.
    function withdrawHbar(address payable to, uint256 amount) external onlyAdmin {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert SendFailed();
        emit HbarWithdrawn(to, amount);
    }

    /// @dev Best effort, never reverts: HSS answers with response codes, and a failed schedule is retried via `schedule`.
    ///      Armed at `target + SCHEDULE_LAG` so the run's `block.timestamp` is past `nextCoupon`; `scheduledFor`
    ///      keeps the coupon second it serves.
    function _schedule(uint256 bondId, uint64 target) internal {
        uint256 when = target + SCHEDULE_LAG;
        if (when < block.timestamp + 5) when = block.timestamp + 5;
        if (when > block.timestamp + HederaHarness.MAX_SCHEDULE_AHEAD) {
            emit ScheduleSkipped(bondId, when);
            return;
        }
        (address sched, int64 rc, uint256 actualWhen) = HederaHarness.scheduleWithProbe(
            address(this), when, SCHEDULE_GAS, abi.encodeCall(this.payCoupon, (bondId)), PROBE_MAX
        );
        if (rc == HederaHarness.SUCCESS) {
            scheduleOf[bondId] = sched;
            scheduledFor[bondId] = target;
            emit CouponScheduled(bondId, sched, actualWhen);
        } else {
            emit ScheduleFailed(bondId, rc);
        }
    }

    function _due(BondRegistry.BondTerms memory t, uint256 supply) internal pure returns (uint256) {
        return supply * t.faceValue * t.couponRateBps * t.couponInterval / (10_000 * YEAR * 10 ** t.bondDecimals);
    }

    function _share(IATSBond token, Coupon storage c, address holder) internal view returns (uint256) {
        uint256 supply = token.totalSupplyAtSnapshot(c.snapshotId);
        if (supply == 0) return 0;
        return c.amount * token.balanceOfAtSnapshot(c.snapshotId, holder) / supply;
    }
}
