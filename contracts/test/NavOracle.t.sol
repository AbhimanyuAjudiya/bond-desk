// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondDeskTest} from "./Base.t.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {RegistryAuth} from "../src/RegistryAuth.sol";
import {NavOracle} from "../src/NavOracle.sol";
import {MockAggregatorV3} from "../src/mocks/MockAggregatorV3.sol";

contract NavOracleTest is BondDeskTest {
    uint256 internal constant FACE = 1e6;
    uint256 internal constant FULL_ACCRUAL = 4109; // 1e6 * 500 bps * 30 days / (10_000 * 365 days), floored

    function _setNextCoupon(uint64 next) internal {
        _grantGate(relayer);
        vm.prank(relayer);
        registry.setNextCoupon(bondId, next);
    }

    function test_constructor_revert_badFeedDecimals() public {
        MockAggregatorV3 bad = new MockAggregatorV3(18, 1);
        vm.expectRevert(abi.encodeWithSelector(NavOracle.BadFeedDecimals.selector, 18));
        new NavOracle(registry, bad, 90_000);
    }

    function test_constructor_storesConfig() public view {
        assertEq(address(oracle.feed()), address(feed));
        assertEq(address(oracle.registry()), address(registry));
        assertEq(oracle.staleAfter(), 90_000);
        assertEq(oracle.YEAR(), 365 days);
    }

    function test_hbarUsd() public {
        assertEq(oracle.hbarUsd(), 5_000_000);
        feed.setAnswer(7_500_000);
        assertEq(oracle.hbarUsd(), 7_500_000);
    }

    function test_hbarUsd_revert_badAnswer() public {
        feed.setAnswer(0);
        vm.expectRevert(abi.encodeWithSelector(NavOracle.BadAnswer.selector, int256(0)));
        oracle.hbarUsd();
        feed.setAnswer(-1);
        vm.expectRevert(abi.encodeWithSelector(NavOracle.BadAnswer.selector, int256(-1)));
        oracle.hbarUsd();
    }

    function test_hbarUsd_revert_stale() public {
        uint256 updatedAt = block.timestamp;
        vm.warp(updatedAt + 90_000);
        assertEq(oracle.hbarUsd(), 5_000_000); // exactly staleAfter is still fresh
        vm.warp(updatedAt + 90_001);
        vm.expectRevert(abi.encodeWithSelector(NavOracle.StaleFeed.selector, updatedAt, 90_000));
        oracle.hbarUsd();
        feed.setAnswer(5_000_000); // fresh round
        assertEq(oracle.hbarUsd(), 5_000_000);
    }

    function test_setStaleAfter() public {
        vm.expectRevert(RegistryAuth.NotAdmin.selector);
        vm.prank(inv1);
        oracle.setStaleAfter(10);

        vm.expectEmit(address(oracle));
        emit NavOracle.StaleAfterSet(10);
        vm.prank(admin);
        oracle.setStaleAfter(10);
        assertEq(oracle.staleAfter(), 10);

        vm.warp(block.timestamp + 11);
        vm.expectRevert(abi.encodeWithSelector(NavOracle.StaleFeed.selector, START, 10));
        oracle.hbarUsd();
    }

    function test_mark_fixture() public view {
        // Base: nextCoupon = now + 1 day, interval 30 days -> 29 days already elapsed in the period
        assertEq(oracle.mark(bondId), FACE + 3972);
    }

    function test_mark_accruesLinearlyWithinPeriod() public {
        _setNextCoupon(uint64(block.timestamp + 30 days)); // period starts now
        assertEq(oracle.mark(bondId), FACE);
        vm.warp(block.timestamp + 15 days);
        assertEq(oracle.mark(bondId), FACE + 2054);
        vm.warp(block.timestamp + 15 days);
        assertEq(oracle.mark(bondId), FACE + FULL_ACCRUAL);
        vm.warp(block.timestamp + 15 days); // coupon overdue, not paid: accrual clamps at one period
        assertEq(oracle.mark(bondId), FACE + FULL_ACCRUAL);
    }

    function test_mark_beforePeriodStart_isFace() public {
        _setNextCoupon(uint64(block.timestamp + 60 days)); // period has not started: elapsed clamps at 0
        assertEq(oracle.mark(bondId), FACE);
    }

    function test_mark_periodStartClampsToZero() public {
        _setNextCoupon(30 days); // nextCoupon <= couponInterval -> periodStart = 0
        assertEq(oracle.mark(bondId), FACE + FULL_ACCRUAL);
    }

    function test_mark_afterMaturity_isFace() public {
        vm.warp(token.getMaturityDate());
        assertEq(oracle.mark(bondId), FACE);
        vm.warp(block.timestamp + 100 days);
        assertEq(oracle.mark(bondId), FACE);
    }

    function test_mark_unknownBond_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 7));
        oracle.mark(7);
    }

    function test_mark_ignoresFeed() public {
        feed.setAnswer(0);
        feed.setUpdatedAt(0);
        assertEq(oracle.mark(bondId), FACE + 3972);
    }

    function testFuzz_mark_boundedByOneCouponAccrual(uint64 dt, uint64 next) public {
        _setNextCoupon(next);
        vm.warp(START + dt);
        uint256 m = oracle.mark(bondId);
        assertGe(m, FACE);
        assertLe(m, FACE + FULL_ACCRUAL);
    }
}
