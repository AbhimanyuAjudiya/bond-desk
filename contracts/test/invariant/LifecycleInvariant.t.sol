// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BondDeskTest} from "../Base.t.sol";
import {BondLifecycle} from "../../src/BondLifecycle.sol";
import {MockATSBond} from "../../src/mocks/MockATSBond.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {MockHSS} from "hedera-harness/mocks/MockHSS.sol";

/// @dev Bounded actions over one bond; reverts are tolerated (fail_on_revert = false), ghosts update only on success.
contract LifecycleHandler is Test {
    BondLifecycle internal lifecycle;
    MockATSBond internal token;
    MockUSDC internal usdc;
    MockHSS internal hss;
    uint256 internal bondId;
    address[3] internal actors; // all KYC'd holders

    uint256 public ghostFunded;
    uint256 public ghostPaidOut; // coupon claims + principal
    uint256 public ghostCouponCount; // highest count observed

    constructor(
        BondLifecycle lifecycle_,
        MockATSBond token_,
        MockUSDC usdc_,
        MockHSS hss_,
        uint256 bondId_,
        address[3] memory actors_
    ) {
        lifecycle = lifecycle_;
        token = token_;
        usdc = usdc_;
        hss = hss_;
        bondId = bondId_;
        actors = actors_;
        usdc.mint(address(this), 1e15);
        usdc.approve(address(lifecycle), type(uint256).max);
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 0, 1e9);
        lifecycle.fund(bondId, amount);
        ghostFunded += amount;
    }

    /// @dev Advances time and fires due HSS schedules, as the network would.
    function warp(uint256 delta) external {
        vm.warp(block.timestamp + bound(delta, 0, 40 days));
        hss.executeDue();
        _observeCount();
    }

    /// @dev `warp` is capped at 40 days per call, so depth 32 rarely reaches maturity (365 days); jump there
    ///      directly so `redeem` (principal payout, `funded -= principal`) is actually exercised.
    function warpToMaturity() external {
        uint256 maturity = token.getMaturityDate();
        if (block.timestamp < maturity) vm.warp(maturity);
        hss.executeDue();
        _observeCount();
    }

    function payCoupon() external {
        lifecycle.payCoupon(bondId);
        _observeCount();
    }

    function claim(uint256 who, uint256 couponId) external {
        uint256 n = lifecycle.couponCount(bondId);
        if (n == 0) return;
        address holder = actors[who % actors.length];
        couponId = bound(couponId, 1, n);
        uint256 amount = lifecycle.claimable(bondId, couponId, holder);
        vm.prank(holder);
        lifecycle.claim(bondId, couponId);
        ghostPaidOut += amount;
    }

    function transfer(uint256 from, uint256 to, uint256 amount) external {
        address f = actors[from % actors.length];
        address t = actors[to % actors.length];
        amount = bound(amount, 0, token.balanceOf(f));
        vm.prank(f);
        token.transfer(t, amount);
    }

    function redeem(uint256 who) external {
        address holder = actors[who % actors.length];
        uint256 before = usdc.balanceOf(holder);
        vm.prank(holder);
        lifecycle.redeem(bondId);
        ghostPaidOut += usdc.balanceOf(holder) - before;
    }

    function _observeCount() internal {
        uint256 c = lifecycle.couponCount(bondId);
        if (c > ghostCouponCount) ghostCouponCount = c;
    }
}

contract LifecycleInvariantTest is BondDeskTest {
    BondLifecycle internal lifecycle;
    LifecycleHandler internal handler;

    function _deployExtensions() internal override {
        lifecycle = new BondLifecycle(registry);
        _grantGate(address(lifecycle));
        vm.deal(address(lifecycle), hbar(20));
        handler = new LifecycleHandler(lifecycle, token, usdc, hss, bondId, [issuer, inv1, inv2]);
        targetContract(address(handler));
    }

    /// @notice Settlement paid to holders never exceeds what was funded; the pool balance is exactly the difference.
    function invariant_paidOutLeFunded() public view {
        assertLe(handler.ghostPaidOut(), handler.ghostFunded());
        assertEq(usdc.balanceOf(address(lifecycle)), handler.ghostFunded() - handler.ghostPaidOut());
        assertGe(usdc.balanceOf(address(lifecycle)), lifecycle.funded(bondId));
    }

    function invariant_couponCountMonotonic() public view {
        assertGe(lifecycle.couponCount(bondId), handler.ghostCouponCount());
    }

    function invariant_claimedTotalLeCouponAmount() public view {
        uint256 n = lifecycle.couponCount(bondId);
        for (uint256 i = 1; i <= n; ++i) {
            (, uint256 amount, uint256 claimedTotal,) = lifecycle.coupons(bondId, i);
            assertLe(claimedTotal, amount);
        }
    }
}
