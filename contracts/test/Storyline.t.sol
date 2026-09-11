// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {ROLE_SNAPSHOT, ROLE_MATURITY_REDEEMER} from "ats/ATSRoles.sol";
import {BondDeskFullTest} from "./Base.t.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {NavOracle} from "../src/NavOracle.sol";
import {BondMarket} from "../src/BondMarket.sol";
import {RiskGate} from "../src/RiskGate.sol";
import {MockATSBond} from "../src/mocks/MockATSBond.sol";

/// @notice The demo storyline end to end on the mock token + mock HSS: issuance/KYC, compliance-gated fills,
///         collateral coverage, a scheduled coupon firing, a signed FREEZE verdict and the admin unfreeze.
///         Each step is a test of its own; `test_storyline_full` runs them in order.
contract StorylineTest is BondDeskFullTest {
    uint128 internal constant PX = 990_000; // 0.99 USDC per bond
    uint256 internal constant DUE = 410_958; // 100 * 1e6 * 500 bps * 30 days / (10_000 * 365 days), floored
    uint8 internal constant FREEZE = uint8(RiskGate.Action.FREEZE);

    uint256 internal orderId;

    // ------------------------------------------------------------------ tests

    function test_storyline_1_issuanceAndKyc() public view {
        _step1();
    }

    function test_storyline_2_nonKycRejected_kycFills() public {
        _step2();
    }

    function test_storyline_3_collateralCoverage() public {
        _step3();
    }

    function test_storyline_4_scheduledCouponFiresAndClaims() public {
        _step2(); // inv1 holds 10, issuer 90
        _step4();
    }

    function test_storyline_5_freezeVerdictHaltsMarket_adminUnfreezes() public {
        _step2(); // live sell order with 10 left
        _step5();
    }

    function test_storyline_full() public {
        console2.log("== 1/5 issuance + KYC");
        _step1();
        console2.log("== 2/5 non-KYC buyer rejected, KYC buyer fills");
        _step2();
        console2.log("== 3/5 collateral deposit + coverage (fresh / stale feed)");
        _step3();
        console2.log("== 4/5 scheduled coupon fires via HSS, holders claim");
        _step4();
        console2.log("== 5/5 FREEZE verdict halts the market, admin unfreezes");
        _step5();
    }

    // ------------------------------------------------------------------ steps

    /// @dev Issuer minted 100, issuer/inv1/inv2 KYC'd, inv3 not; bond 1 Active with the fixture terms; all roles set.
    function _step1() internal view {
        assertEq(token.balanceOf(issuer), 100);
        assertEq(token.totalSupply(), 100);
        assertEq(token.getKycStatusFor(issuer), 1);
        assertEq(token.getKycStatusFor(inv1), 1);
        assertEq(token.getKycStatusFor(inv2), 1);
        assertEq(token.getKycStatusFor(inv3), 0);

        BondRegistry.BondTerms memory t = registry.terms(bondId);
        assertEq(uint8(t.status), uint8(BondRegistry.Status.Active));
        assertEq(t.token, address(token));
        assertEq(t.settlement, address(usdc));
        assertEq(t.issuer, issuer);
        assertEq(t.faceValue, 1e6);
        assertEq(t.couponRateBps, 500);
        assertEq(t.maturity, uint64(token.getMaturityDate()));

        bytes32 gate = registry.GATE_ROLE();
        assertTrue(registry.hasRole(gate, address(riskGate)));
        assertTrue(registry.hasRole(gate, address(lifecycle)));
        assertTrue(token.hasRole(ROLE_SNAPSHOT, address(lifecycle)));
        assertTrue(token.hasRole(ROLE_SNAPSHOT, address(vault)));
        assertTrue(token.hasRole(ROLE_MATURITY_REDEEMER, address(lifecycle)));
    }

    /// @dev Issuer asks 20 @ 0.99; inv3 (no KYC) is rejected with 0x10 / InvalidKycStatus; inv1 takes 10.
    function _step2() internal {
        vm.prank(issuer);
        orderId = market.place(bondId, true, 20, PX, uint64(block.timestamp + 7 days));

        vm.prank(address(market));
        (bool ok, bytes1 code, bytes32 reason) = token.canTransferFrom(issuer, inv3, 10, "");
        assertFalse(ok);
        assertEq(code, bytes1(0x10));
        assertEq(reason, bytes32(MockATSBond.InvalidKycStatus.selector));

        vm.expectRevert(abi.encodeWithSelector(BondMarket.ComplianceRejected.selector, code, reason));
        vm.prank(inv3);
        market.fill(orderId, 10);

        uint256 usdcBefore = usdc.balanceOf(inv1);
        vm.prank(inv1);
        market.fill(orderId, 10);
        assertEq(token.balanceOf(inv1), 10);
        assertEq(token.balanceOf(issuer), 90);
        assertEq(usdcBefore - usdc.balanceOf(inv1), 10 * uint256(PX));
        (,,, uint128 left,,) = market.orders(orderId);
        assertEq(left, 10);
        (, uint128 bestAsk) = market.quote(bondId);
        assertEq(bestAsk, PX);
    }

    /// @dev 100 HBAR at $0.05 against 100 * $1 principal = 500 bps; a stale feed reverts coverage but not snapshot.
    function _step3() internal {
        vm.prank(issuer);
        vault.deposit{value: hbar(100)}(bondId);
        assertEq(vault.collateral(bondId), hbar(100));
        assertEq(vault.coverageBps(bondId), 500);

        RiskGate.Snapshot memory s = riskGate.snapshot(bondId);
        assertTrue(s.feedFresh);
        assertEq(s.coverageBps, 500);
        assertEq(s.collateral, hbar(100));
        assertEq(s.status, uint8(BondRegistry.Status.Active));

        feed.setUpdatedAt(block.timestamp - 90_001);
        vm.expectRevert(abi.encodeWithSelector(NavOracle.StaleFeed.selector, block.timestamp - 90_001, 90_000));
        vault.coverageBps(bondId);
        s = riskGate.snapshot(bondId);
        assertFalse(s.feedFresh);
        assertEq(s.coverageBps, 0);

        feed.setAnswer(5_000_000); // fresh round again
        assertEq(vault.coverageBps(bondId), 500);
    }

    /// @dev Fund, schedule the first coupon on HSS, let it fire, then inv1 (10) and issuer (90) claim pro-rata.
    function _step4() internal {
        uint64 firstCoupon = registry.terms(bondId).nextCoupon;
        vm.prank(issuer);
        lifecycle.fund(bondId, 100e6);

        lifecycle.schedule(bondId);
        address sched = lifecycle.scheduleOf(bondId);
        assertTrue(sched != address(0));
        assertEq(hss.get(sched).when, firstCoupon + lifecycle.SCHEDULE_LAG());
        assertEq(lifecycle.couponCount(bondId), 0);

        warpAndExecute(hss.get(sched).when);
        assertTrue(hss.get(sched).executed);
        assertEq(lifecycle.couponCount(bondId), 1);
        (, uint256 amount,,) = lifecycle.coupons(bondId, 1);
        assertEq(amount, DUE);
        assertEq(lifecycle.funded(bondId), 100e6 - DUE);
        assertEq(registry.terms(bondId).nextCoupon, firstCoupon + 30 days);
        address next = lifecycle.scheduleOf(bondId); // re-scheduled from inside the scheduled run
        assertTrue(next != address(0) && next != sched);

        assertEq(lifecycle.claimable(bondId, 1, inv1), DUE * 10 / 100);
        uint256 before = usdc.balanceOf(inv1);
        vm.prank(inv1);
        lifecycle.claim(bondId, 1);
        assertEq(usdc.balanceOf(inv1) - before, DUE * 10 / 100);

        before = usdc.balanceOf(issuer);
        vm.prank(issuer);
        lifecycle.claim(bondId, 1);
        assertEq(usdc.balanceOf(issuer) - before, DUE * 90 / 100);
        assertEq(lifecycle.claimable(bondId, 1, inv1), 0);
    }

    /// @dev Relayer lands a signed FREEZE: fills and new orders revert BondNotActive(Frozen); admin unfreezes,
    ///      trading resumes; the same verdict cannot be replayed.
    function _step5() internal {
        RiskGate.Verdict memory v = verdict(bondId, FREEZE, 250, riskGate.lastNonce(bondId) + 1);
        bytes memory sig = signVerdict(v);
        vm.prank(relayer);
        riskGate.submit(v, sig);
        assertEq(uint8(registry.status(bondId)), uint8(BondRegistry.Status.Frozen));
        assertEq(riskGate.lastNonce(bondId), v.nonce);

        bytes memory frozen =
            abi.encodeWithSelector(BondMarket.BondNotActive.selector, bondId, BondRegistry.Status.Frozen);
        vm.expectRevert(frozen);
        vm.prank(inv1);
        market.fill(orderId, 5);
        vm.expectRevert(frozen);
        vm.prank(inv2);
        market.place(bondId, false, 1, PX, 0);

        vm.prank(admin);
        riskGate.unfreeze(bondId);
        assertEq(uint8(registry.status(bondId)), uint8(BondRegistry.Status.Active));

        uint256 before = token.balanceOf(inv1);
        vm.prank(inv1);
        market.fill(orderId, 5);
        assertEq(token.balanceOf(inv1) - before, 5);

        vm.expectRevert(abi.encodeWithSelector(RiskGate.StaleNonce.selector, v.nonce, v.nonce));
        vm.prank(relayer);
        riskGate.submit(v, sig);
    }
}
