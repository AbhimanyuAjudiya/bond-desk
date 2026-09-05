// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HederaTest} from "../src/HederaTest.sol";
import {PingWithHarness} from "../examples/WithHarness.sol";
import {PingWithoutHarness} from "../examples/WithoutHarness.sol";

contract ExamplesTest is HederaTest {
    uint256 internal constant T0 = 1_700_000_000;

    PingWithHarness internal withH;
    PingWithoutHarness internal withoutH;
    uint256 internal when;

    function setUp() public override {
        super.setUp();
        vm.warp(T0);
        withH = new PingWithHarness();
        withoutH = new PingWithoutHarness();
        vm.deal(address(withH), hbar(5));
        vm.deal(address(withoutH), hbar(5));
        when = T0 + 120;
    }

    // ---- with harness ----

    function test_withHarness_pingFiresOnSchedule() public {
        (address sched, uint256 actual) = withH.schedulePing(when);
        assertEq(actual, when);
        assertEq(hss.get(sched).to, address(withH));
        warpAndExecute(when);
        assertEq(withH.pings(), 1);
    }

    function test_withHarness_slidesWhenSecondBusy() public {
        hss.setBusy(when, true);
        (, uint256 actual) = withH.schedulePing(when);
        assertEq(actual, when + 1);
        warpAndExecute(when);
        assertEq(withH.pings(), 0);
        warpAndExecute(when + 1);
        assertEq(withH.pings(), 1);
    }

    function test_withHarness_revertsWhenNoCapacity() public {
        hss.setNoCapacity(true);
        vm.expectRevert(abi.encodeWithSelector(PingWithHarness.ScheduleFailed.selector, int64(370)));
        withH.schedulePing(when);
    }

    // ---- without harness ----

    function test_withoutHarness_pingFiresOnSchedule() public {
        (, uint256 actual) = withoutH.schedulePing(when);
        assertEq(actual, when);
        warpAndExecute(when);
        assertEq(withoutH.pings(), 1);
    }

    function test_withoutHarness_slidesWhenSecondBusy() public {
        hss.setBusy(when, true);
        (, uint256 actual) = withoutH.schedulePing(when);
        assertEq(actual, when + 1);
    }

    function test_withoutHarness_revertsWhenNoCapacity() public {
        hss.setNoCapacity(true);
        vm.expectRevert(
            abi.encodeWithSelector(PingWithoutHarness.ScheduleFailed.selector, int64(370), "SCHEDULE_EXPIRY_IS_BUSY")
        );
        withoutH.schedulePing(when);
    }

    function test_withoutHarness_revertsOnBadWindow() public {
        vm.expectRevert(abi.encodeWithSelector(PingWithoutHarness.ExpiryInPast.selector, T0));
        withoutH.schedulePing(T0);
        vm.expectRevert(abi.encodeWithSelector(PingWithoutHarness.ExpiryTooFar.selector, T0 + 63 days));
        withoutH.schedulePing(T0 + 63 days);
    }

    // ---- equivalence ----

    function testFuzz_examples_pickTheSameSecond(bytes32 seed, uint8 busyMask) public {
        vm.prevrandao(seed);
        for (uint256 i = 0; i < 8; ++i) {
            if ((busyMask >> i) & 1 != 0) hss.setBusy(when + i, true);
        }
        (, uint256 a) = withH.schedulePing(when);
        (, uint256 b) = withoutH.schedulePing(when);
        assertEq(a, b);
        assertGe(a, when);
        warpAndExecute(a);
        assertEq(withH.pings(), 1);
        assertEq(withoutH.pings(), 1);
    }
}
