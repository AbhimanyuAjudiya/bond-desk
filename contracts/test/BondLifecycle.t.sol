// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {BondDeskTest} from "./Base.t.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {RegistryAuth} from "../src/RegistryAuth.sol";
import {BondLifecycle} from "../src/BondLifecycle.sol";
import {MockHSS} from "hedera-harness/mocks/MockHSS.sol";

contract BondLifecycleTest is BondDeskTest {
    uint256 internal constant DUE = 410_958; // 100 * 1e6 * 500 bps * 30 days / (10_000 * 365 days), floored
    uint256 internal constant PRINCIPAL = 100e6; // 100 tokens * faceValue 1e6
    uint64 internal constant INTERVAL = 30 days;

    BondLifecycle internal lifecycle;
    uint64 internal firstCoupon;
    uint64 internal maturity;

    function _deployExtensions() internal override {
        lifecycle = new BondLifecycle(registry);
        _grantGate(address(lifecycle));
        vm.deal(address(lifecycle), hbar(20)); // HSS payer float
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        firstCoupon = t.nextCoupon;
        maturity = t.maturity;
        vm.prank(issuer);
        usdc.approve(address(lifecycle), type(uint256).max);
    }

    function _fund(uint256 amount) internal {
        vm.prank(issuer);
        lifecycle.fund(bondId, amount);
    }

    function _setStatus(BondRegistry.Status s) internal {
        _grantGate(relayer);
        vm.prank(relayer);
        registry.setStatus(bondId, s);
    }

    function _setNextCoupon(uint64 next) internal {
        _grantGate(relayer);
        vm.prank(relayer);
        registry.setNextCoupon(bondId, next);
    }

    function _payFirstCoupon() internal {
        _fund(1e8);
        vm.warp(firstCoupon);
        lifecycle.payCoupon(bondId);
    }

    // ------------------------------------------------------------------ fund

    function test_fund_pullsSettlement() public {
        uint256 before = usdc.balanceOf(issuer);
        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.Funded(bondId, issuer, 1e8);
        _fund(1e8);
        assertEq(lifecycle.funded(bondId), 1e8);
        assertEq(usdc.balanceOf(address(lifecycle)), 1e8);
        assertEq(usdc.balanceOf(issuer), before - 1e8);

        // anyone may fund
        vm.startPrank(inv1);
        usdc.approve(address(lifecycle), 1);
        lifecycle.fund(bondId, 1);
        vm.stopPrank();
        assertEq(lifecycle.funded(bondId), 1e8 + 1);

        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 9));
        lifecycle.fund(9, 1);
    }

    // ------------------------------------------------------------- payCoupon

    function test_payCoupon_revertsBeforeDue() public {
        _fund(1e8);
        vm.warp(firstCoupon - 1);
        vm.expectRevert(abi.encodeWithSelector(BondLifecycle.CouponNotDue.selector, firstCoupon));
        lifecycle.payCoupon(bondId);
    }

    function test_payCoupon_takesSnapshotAndOpensClaim() public {
        _fund(1e8);
        assertEq(lifecycle.couponDue(bondId), DUE);
        vm.warp(firstCoupon);
        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.CouponPaid(bondId, 1, 1, DUE, firstCoupon + INTERVAL);
        vm.prank(inv3); // anyone
        lifecycle.payCoupon(bondId);

        assertEq(lifecycle.couponCount(bondId), 1);
        assertEq(token.currentSnapshotId(), 1);
        (uint256 snapshotId, uint256 amount, uint256 claimedTotal, uint64 paidAt) = lifecycle.coupons(bondId, 1);
        assertEq(snapshotId, 1);
        assertEq(amount, DUE);
        assertEq(claimedTotal, 0);
        assertEq(paidAt, firstCoupon);
        assertEq(lifecycle.funded(bondId), 1e8 - DUE);
        assertEq(lifecycle.claimable(bondId, 1, issuer), DUE);
        assertEq(lifecycle.claimable(bondId, 1, inv1), 0);
    }

    function test_payCoupon_revertsUnderfunded() public {
        _fund(DUE - 1);
        vm.warp(firstCoupon);
        vm.expectRevert(abi.encodeWithSelector(BondLifecycle.CouponUnderfunded.selector, DUE, DUE - 1));
        lifecycle.payCoupon(bondId);
        assertEq(token.currentSnapshotId(), 0); // snapshot rolled back with the revert
    }

    function test_payCoupon_advancesNextCouponAndSchedules() public {
        _fund(1e8);
        vm.warp(firstCoupon);
        uint64 next = firstCoupon + INTERVAL;
        address sched = hss.addressOf(0);
        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.CouponScheduled(bondId, sched, next);
        lifecycle.payCoupon(bondId);

        assertEq(registry.terms(bondId).nextCoupon, next);
        assertEq(lifecycle.scheduleOf(bondId), sched);
        assertEq(lifecycle.scheduledFor(bondId), next);
        MockHSS.Scheduled memory s = hss.get(sched);
        assertEq(s.to, address(lifecycle));
        assertEq(s.when, next);
        assertEq(s.gas, lifecycle.SCHEDULE_GAS());
        assertEq(s.data, abi.encodeCall(BondLifecycle.payCoupon, (bondId)));
    }

    function test_payCoupon_scheduleFailedEmits_noRevert() public {
        _fund(1e8);
        hss.setNoCapacity(true);
        vm.warp(firstCoupon);
        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.ScheduleFailed(bondId, 370);
        lifecycle.payCoupon(bondId);
        assertEq(lifecycle.couponCount(bondId), 1);
        assertEq(lifecycle.scheduleOf(bondId), address(0));
        assertEq(hss.count(), 0);

        // permissionless retry once capacity is back
        hss.setNoCapacity(false);
        lifecycle.schedule(bondId);
        assertEq(lifecycle.scheduledFor(bondId), firstCoupon + INTERVAL);
        assertEq(hss.count(), 1);
    }

    function test_payCoupon_nested373Emits_noRevert() public {
        _fund(1e8);
        lifecycle.schedule(bondId);
        hss.setBlockNested(true);
        vm.warp(firstCoupon);
        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.ScheduleFailed(bondId, 373);
        executeDueSchedules(); // payCoupon runs inside the scheduled execution; its re-schedule hits 373
        assertEq(lifecycle.couponCount(bondId), 1);
        assertEq(lifecycle.scheduleOf(bondId), address(0));
        assertEq(hss.count(), 1);

        // retry from outside a scheduled execution succeeds
        lifecycle.schedule(bondId);
        assertEq(hss.count(), 2);
        assertEq(lifecycle.scheduledFor(bondId), firstCoupon + INTERVAL);
    }

    function test_payCoupon_revertsWhenDefaulted() public {
        _fund(1e8);
        vm.warp(firstCoupon);
        _setStatus(BondRegistry.Status.Defaulted);
        vm.expectRevert(abi.encodeWithSelector(BondLifecycle.BadStatus.selector, BondRegistry.Status.Defaulted));
        lifecycle.payCoupon(bondId);
        _setStatus(BondRegistry.Status.Matured);
        vm.expectRevert(abi.encodeWithSelector(BondLifecycle.BadStatus.selector, BondRegistry.Status.Matured));
        lifecycle.payCoupon(bondId);
    }

    function test_payCoupon_worksWhenFrozen() public {
        _setStatus(BondRegistry.Status.Frozen);
        _payFirstCoupon();
        assertEq(lifecycle.couponCount(bondId), 1);
        assertEq(uint8(registry.status(bondId)), uint8(BondRegistry.Status.Frozen));
    }

    function test_payCoupon_revertsAfterLastCoupon() public {
        _fund(20 * DUE);
        uint64 next = firstCoupon;
        uint256 n;
        while (next <= maturity) {
            vm.warp(next);
            lifecycle.payCoupon(bondId);
            next += INTERVAL;
            ++n;
        }
        assertEq(n, 13);
        assertEq(lifecycle.couponCount(bondId), 13);
        assertEq(registry.terms(bondId).nextCoupon, next);
        assertGt(next, maturity);
        assertEq(lifecycle.scheduleOf(bondId), address(0)); // nothing scheduled past maturity

        vm.warp(next);
        vm.expectRevert(BondLifecycle.NoMoreCoupons.selector);
        lifecycle.payCoupon(bondId);
    }

    // ----------------------------------------------------------------- claim

    function test_claim_proRataBySnapshot() public {
        vm.startPrank(issuer);
        token.transfer(inv1, 30);
        token.transfer(inv2, 20);
        vm.stopPrank();
        _payFirstCoupon();

        uint256 s0 = DUE * 50 / 100;
        uint256 s1 = DUE * 30 / 100;
        uint256 s2 = DUE * 20 / 100;
        assertEq(lifecycle.claimable(bondId, 1, issuer), s0);
        assertEq(lifecycle.claimable(bondId, 1, inv1), s1);
        assertEq(lifecycle.claimable(bondId, 1, inv2), s2);

        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.CouponClaimed(bondId, 1, inv1, s1);
        vm.prank(inv1);
        lifecycle.claim(bondId, 1);
        assertEq(usdc.balanceOf(inv1), 1e12 + s1);
        assertEq(lifecycle.claimable(bondId, 1, inv1), 0);
        assertTrue(lifecycle.claimed(bondId, 1, inv1));

        vm.prank(inv2);
        lifecycle.claim(bondId, 1);
        vm.prank(issuer);
        lifecycle.claim(bondId, 1);
        (,, uint256 claimedTotal,) = lifecycle.coupons(bondId, 1);
        assertEq(claimedTotal, s0 + s1 + s2);
        assertLe(claimedTotal, DUE);
    }

    function test_claim_revertsTwice() public {
        _payFirstCoupon();
        vm.prank(issuer);
        lifecycle.claim(bondId, 1);
        vm.prank(issuer);
        vm.expectRevert(BondLifecycle.AlreadyClaimed.selector);
        lifecycle.claim(bondId, 1);

        vm.expectRevert(BondLifecycle.NoCoupon.selector);
        lifecycle.claim(bondId, 2);
        vm.prank(inv3);
        vm.expectRevert(BondLifecycle.NothingToClaim.selector);
        lifecycle.claim(bondId, 1);
    }

    function test_claim_transferAfterSnapshotDoesNotChangeShare() public {
        _payFirstCoupon();
        vm.prank(issuer);
        token.transfer(inv1, 50);
        assertEq(lifecycle.claimable(bondId, 1, inv1), 0);
        assertEq(lifecycle.claimable(bondId, 1, issuer), DUE);

        vm.prank(inv1);
        vm.expectRevert(BondLifecycle.NothingToClaim.selector);
        lifecycle.claim(bondId, 1);
        vm.prank(issuer);
        lifecycle.claim(bondId, 1);
        assertEq(usdc.balanceOf(issuer), 1e12 - 1e8 + DUE);
    }

    // -------------------------------------------------------------- schedule

    function test_schedule_slidesWhenBusy() public {
        hss.setBusy(firstCoupon, true);
        lifecycle.schedule(bondId);
        address sched = lifecycle.scheduleOf(bondId);
        assertTrue(sched != address(0));
        uint256 when = hss.get(sched).when;
        assertGt(when, firstCoupon);
        assertEq(lifecycle.scheduledFor(bondId), firstCoupon); // still keyed to the coupon it serves
    }

    function test_schedule_skipsBeyond62Days() public {
        uint64 far = uint64(block.timestamp + 63 days);
        _setNextCoupon(far);
        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.ScheduleSkipped(bondId, far);
        lifecycle.schedule(bondId);
        assertEq(lifecycle.scheduleOf(bondId), address(0));
        assertEq(hss.count(), 0);

        // exactly 62 days ahead is inside the HSS window
        _setNextCoupon(uint64(block.timestamp + 62 days));
        lifecycle.schedule(bondId);
        assertEq(hss.count(), 1);
    }

    function test_schedule_revertsAlreadyScheduled() public {
        lifecycle.schedule(bondId);
        vm.expectRevert(BondLifecycle.AlreadyScheduled.selector);
        lifecycle.schedule(bondId);
    }

    function test_scheduledCall_firesViaMockHss() public {
        _fund(1e8);
        lifecycle.schedule(bondId);
        assertEq(lifecycle.couponCount(bondId), 0);
        warpAndExecute(firstCoupon);
        assertEq(lifecycle.couponCount(bondId), 1);
        assertEq(registry.terms(bondId).nextCoupon, firstCoupon + INTERVAL);
        assertTrue(hss.get(hss.addressOf(0)).executed);
        assertEq(hss.count(), 2); // next coupon scheduled from inside the execution
        assertEq(lifecycle.scheduleOf(bondId), hss.addressOf(1));
        assertFalse(hss.get(hss.addressOf(0)).deleted); // self-delete answers 213 and is ignored
    }

    function test_payCoupon_byHandDeletesPendingSchedule() public {
        _fund(1e8);
        lifecycle.schedule(bondId);
        address pending = hss.addressOf(0);
        vm.warp(firstCoupon); // due, but the scheduled run has not fired yet (it may have slid under load)
        lifecycle.payCoupon(bondId);
        assertTrue(hss.get(pending).deleted);
        assertEq(lifecycle.scheduleOf(bondId), hss.addressOf(1)); // next coupon still scheduled

        executeDueSchedules(); // the stale run must not burn an execution of the HBAR float
        assertFalse(hss.get(pending).executed);
        assertEq(lifecycle.couponCount(bondId), 1);
    }

    // ---------------------------------------------------------------- redeem

    function test_redeem_revertsBeforeMaturity() public {
        _fund(PRINCIPAL);
        vm.warp(maturity - 1);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(BondLifecycle.NotMatured.selector, maturity));
        lifecycle.redeem(bondId);
    }

    function test_redeem_paysPrincipalAndBurns() public {
        vm.prank(issuer);
        token.transfer(inv1, 40);
        _fund(PRINCIPAL);
        vm.warp(maturity);
        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.Redeemed(bondId, inv1, 40, 40e6);
        vm.prank(inv1);
        lifecycle.redeem(bondId);

        assertEq(token.balanceOf(inv1), 0);
        assertEq(token.totalSupply(), 60);
        assertEq(usdc.balanceOf(inv1), 1e12 + 40e6);
        assertEq(lifecycle.funded(bondId), PRINCIPAL - 40e6);

        vm.prank(inv1);
        vm.expectRevert(BondLifecycle.NothingToRedeem.selector);
        lifecycle.redeem(bondId);
    }

    function test_redeem_setsMatured() public {
        vm.prank(issuer);
        token.transfer(inv1, 40);
        _fund(PRINCIPAL);
        vm.warp(maturity);

        _setStatus(BondRegistry.Status.Defaulted);
        vm.prank(inv1);
        vm.expectRevert(abi.encodeWithSelector(BondLifecycle.BadStatus.selector, BondRegistry.Status.Defaulted));
        lifecycle.redeem(bondId);
        _setStatus(BondRegistry.Status.Active);

        vm.expectEmit(address(registry));
        emit BondRegistry.StatusChanged(bondId, BondRegistry.Status.Active, BondRegistry.Status.Matured);
        vm.prank(inv1);
        lifecycle.redeem(bondId);
        assertEq(uint8(registry.status(bondId)), uint8(BondRegistry.Status.Matured));

        // already Matured: no second status change
        vm.recordLogs();
        vm.prank(issuer);
        lifecycle.redeem(bondId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != BondRegistry.StatusChanged.selector);
        }
        assertEq(token.totalSupply(), 0);
        assertEq(lifecycle.funded(bondId), 0);
    }

    function test_redeem_revertsUnderfunded() public {
        _fund(PRINCIPAL - 1);
        vm.warp(maturity);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(BondLifecycle.PrincipalUnderfunded.selector, PRINCIPAL, PRINCIPAL - 1));
        lifecycle.redeem(bondId);
        assertEq(token.balanceOf(issuer), 100);
    }

    // ------------------------------------------------------------------ hbar

    function test_receive_acceptsHbar_withdrawHbarAdmin() public {
        vm.deal(address(lifecycle), 0);
        vm.deal(admin, hbar(5));
        vm.prank(admin);
        (bool ok,) = address(lifecycle).call{value: hbar(5)}("");
        assertTrue(ok);
        assertEq(address(lifecycle).balance, hbar(5));

        vm.prank(inv1);
        vm.expectRevert(RegistryAuth.NotAdmin.selector);
        lifecycle.withdrawHbar(payable(inv1), 1);

        vm.expectEmit(address(lifecycle));
        emit BondLifecycle.HbarWithdrawn(inv1, hbar(2));
        vm.prank(admin);
        lifecycle.withdrawHbar(payable(inv1), hbar(2));
        assertEq(inv1.balance, hbar(2));
        assertEq(address(lifecycle).balance, hbar(3));

        vm.prank(admin);
        vm.expectRevert(BondLifecycle.SendFailed.selector);
        lifecycle.withdrawHbar(payable(address(registry)), 1); // registry has no receive
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_claims_sumLeCouponAmount(uint8 a, uint8 b) public {
        uint256 toInv1 = bound(a, 0, 100);
        uint256 toInv2 = bound(b, 0, 100 - toInv1);
        vm.startPrank(issuer);
        token.transfer(inv1, toInv1);
        token.transfer(inv2, toInv2);
        vm.stopPrank();
        _payFirstCoupon();

        address[3] memory holders = [issuer, inv1, inv2];
        uint256 sum;
        for (uint256 i; i < holders.length; ++i) {
            uint256 c = lifecycle.claimable(bondId, 1, holders[i]);
            if (c == 0) continue;
            vm.prank(holders[i]);
            lifecycle.claim(bondId, 1);
            sum += c;
        }
        assertLe(sum, DUE);
        (,, uint256 claimedTotal,) = lifecycle.coupons(bondId, 1);
        assertEq(claimedTotal, sum);
        assertEq(usdc.balanceOf(address(lifecycle)), 1e8 - sum); // rounding dust stays in the contract
        assertGe(usdc.balanceOf(address(lifecycle)), lifecycle.funded(bondId));
    }
}
