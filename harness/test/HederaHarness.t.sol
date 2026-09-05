// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HederaTest} from "../src/HederaTest.sol";
import {HederaHarness} from "../src/HederaHarness.sol";
import {MockHSS} from "../src/mocks/MockHSS.sol";

/// @dev Minimal consumer so the library runs inside a contract that is itself the HSS payer / HTS account.
contract Counter {
    uint256 public hits;
    bool public reschedule;
    address public lastSchedule;
    int64 public lastRc;

    function hit() external {
        hits++;
        if (reschedule) {
            (lastSchedule, lastRc) =
                HederaHarness.schedule(address(this), block.timestamp + 10, 500_000, abi.encodeCall(this.hit, ()));
        }
    }

    function setReschedule(bool v) external {
        reschedule = v;
    }

    function associate(address token) external returns (int64) {
        return HederaHarness.associate(token);
    }

    function send(address token, address to, int64 amount) external returns (int64) {
        return HederaHarness.htsTransfer(token, to, amount);
    }
}

contract HederaHarnessTest is HederaTest {
    uint256 internal constant GAS = 2_000_000;
    uint256 internal constant T0 = 1_700_000_000;
    address internal constant FIRST_SCHEDULE = address(0x5c4ed000);

    Counter internal counter;
    bytes internal data;
    uint256 internal when;

    function setUp() public override {
        super.setUp();
        vm.warp(T0);
        counter = new Counter();
        data = abi.encodeCall(counter.hit, ());
        when = T0 + 60;
    }

    // ---- install ----

    function test_installHedera_etchesMocksAtSystemAddresses() public view {
        assertGt(address(0x16b).code.length, 0);
        assertGt(address(0x167).code.length, 0);
        assertEq(address(hss), address(HederaHarness.HSS));
        assertEq(address(hts), address(HederaHarness.HTS));
        assertEq(hss.count(), 0);
        assertFalse(hss.noCapacity());
    }

    function test_constants() public pure {
        assertEq(address(HederaHarness.HSS), address(0x16b));
        assertEq(address(HederaHarness.HTS), address(0x167));
        assertEq(HederaHarness.CHAIN_TESTNET, 296);
        assertEq(HederaHarness.MAX_SCHEDULE_AHEAD, 62 days);
        assertEq(HederaHarness.TINYBAR * HederaHarness.WEIBAR_PER_TINYBAR, 1 ether);
        assertTrue(HederaHarness.ok(22));
        assertFalse(HederaHarness.ok(370));
    }

    function test_hbar_isTinybar() public pure {
        assertEq(hbar(5), 5e8);
    }

    // ---- schedule ----

    function test_schedule_success() public {
        (address sched, int64 rc) = HederaHarness.schedule(address(counter), when, GAS, data);
        assertEq(rc, HederaHarness.SUCCESS);
        assertEq(sched, FIRST_SCHEDULE);
        assertEq(hss.count(), 1);
        assertEq(hss.idOf(sched), 1);
        MockHSS.Scheduled memory s = hss.get(sched);
        assertEq(s.to, address(counter));
        assertEq(s.when, when);
        assertEq(s.gas, GAS);
        assertEq(s.data, data);
        assertEq(s.creator, address(this));
        assertFalse(s.executed);
        assertFalse(s.deleted);
    }

    function test_schedule_zeroTarget_returns16() public {
        (address sched, int64 rc) = HederaHarness.schedule(address(0), when, GAS, data);
        assertEq(rc, HederaHarness.INVALID_CONTRACT_ID);
        assertEq(sched, address(0));
        assertEq(hss.count(), 0);
    }

    function test_schedule_pastSecond_returns307() public {
        (, int64 rc) = HederaHarness.schedule(address(counter), T0, GAS, data);
        assertEq(rc, HederaHarness.SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME);
        assertEq(hss.count(), 0);
    }

    function test_schedule_tooFar_returns306() public {
        (, int64 rc) = HederaHarness.schedule(address(counter), T0 + 62 days + 1, GAS, data);
        assertEq(rc, HederaHarness.SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE);
        (, rc) = HederaHarness.schedule(address(counter), T0 + 62 days, GAS, data);
        assertEq(rc, HederaHarness.SUCCESS);
    }

    function test_schedule_busySecond_returns370() public {
        hss.setBusy(when, true);
        (, int64 rc) = HederaHarness.schedule(address(counter), when, GAS, data);
        assertEq(rc, HederaHarness.SCHEDULE_EXPIRY_IS_BUSY);
        assertEq(hss.count(), 0);
    }

    function test_schedule_noCapacity_returns370() public {
        hss.setNoCapacity(true);
        (, int64 rc) = HederaHarness.schedule(address(counter), when, GAS, data);
        assertEq(rc, HederaHarness.SCHEDULE_EXPIRY_IS_BUSY);
    }

    function test_scheduleCallWithPayer_behavesLikeScheduleCall() public {
        (int64 rc, address sched) = hss.scheduleCallWithPayer(address(counter), address(0xBEEF), when, GAS, 0, data);
        assertEq(rc, HederaHarness.SUCCESS);
        assertEq(sched, FIRST_SCHEDULE);
    }

    // ---- capacity + probing ----

    function test_hasCapacity_window() public {
        assertFalse(HederaHarness.hasCapacity(T0, GAS));
        assertTrue(HederaHarness.hasCapacity(T0 + 1, GAS));
        assertTrue(HederaHarness.hasCapacity(T0 + 62 days, GAS));
        assertFalse(HederaHarness.hasCapacity(T0 + 62 days + 1, GAS));
        hss.setBusy(when, true);
        assertFalse(HederaHarness.hasCapacity(when, GAS));
        hss.setNoCapacity(true);
        assertFalse(HederaHarness.hasCapacity(when + 1, GAS));
    }

    function test_findAvailableSecond_freeSecondReturnsWhen() public view {
        (uint256 second, bool found) = HederaHarness.findAvailableSecond(when, GAS, 8);
        assertTrue(found);
        assertEq(second, when);
    }

    function test_findAvailableSecond_slidesPastBusySecond() public {
        hss.setBusy(when, true);
        (uint256 second, bool found) = HederaHarness.findAvailableSecond(when, GAS, 8);
        assertTrue(found);
        assertEq(second, when + 1); // probe 0: base 1, jitter % 1 == 0
    }

    function test_findAvailableSecond_walksExponentialWindowsWithJitter() public {
        bytes32 seed = keccak256("prevrandao");
        vm.prevrandao(seed);
        hss.setBusy(when, true);
        for (uint256 i = 0; i < 3; ++i) {
            hss.setBusy(_candidate(seed, i), true);
        }
        (uint256 second, bool found) = HederaHarness.findAvailableSecond(when, GAS, 8);
        assertTrue(found);
        assertEq(second, _candidate(seed, 3));
        assertGe(second, when + 8);
        assertLt(second, when + 16);
    }

    function test_findAvailableSecond_noCapacity_returnsNotFound() public {
        hss.setNoCapacity(true);
        (uint256 second, bool found) = HederaHarness.findAvailableSecond(when, GAS, 8);
        assertFalse(found);
        assertEq(second, 0);
    }

    function test_findAvailableSecond_zeroProbes_onlyChecksWhen() public {
        hss.setBusy(when, true);
        (, bool found) = HederaHarness.findAvailableSecond(when, GAS, 0);
        assertFalse(found);
    }

    function testFuzz_findAvailableSecond_neverRevertsAndStaysAhead(uint256 target, uint8 probes, bytes32 seed)
        public
    {
        target = bound(target, 0, T0 + 70 days);
        vm.prevrandao(seed);
        hss.setBusy(target, true);
        (uint256 second, bool found) = HederaHarness.findAvailableSecond(target, GAS, probes);
        if (found) {
            assertGt(second, target);
            assertTrue(HederaHarness.hasCapacity(second, GAS));
        } else {
            assertEq(second, 0);
        }
    }

    function test_scheduleWithProbe_freeSecond() public {
        (address sched, int64 rc, uint256 actual) =
            HederaHarness.scheduleWithProbe(address(counter), when, GAS, data, 8);
        assertEq(rc, HederaHarness.SUCCESS);
        assertEq(sched, FIRST_SCHEDULE);
        assertEq(actual, when);
    }

    function test_scheduleWithProbe_slidesToFreeSecond() public {
        hss.setBusy(when, true);
        (address sched, int64 rc, uint256 actual) =
            HederaHarness.scheduleWithProbe(address(counter), when, GAS, data, 8);
        assertEq(rc, HederaHarness.SUCCESS);
        assertEq(actual, when + 1);
        assertEq(hss.get(sched).when, when + 1);
    }

    function test_scheduleWithProbe_noCapacity_returns370WithoutScheduling() public {
        hss.setNoCapacity(true);
        (address sched, int64 rc, uint256 actual) =
            HederaHarness.scheduleWithProbe(address(counter), when, GAS, data, 8);
        assertEq(rc, HederaHarness.SCHEDULE_EXPIRY_IS_BUSY);
        assertEq(sched, address(0));
        assertEq(actual, 0);
        assertEq(hss.count(), 0);
    }

    // ---- execution ----

    function test_warpAndExecute_firesDueScheduleOnce() public {
        (address sched,) = HederaHarness.schedule(address(counter), when, GAS, data);
        vm.expectEmit(true, true, true, true, address(hss));
        emit MockHSS.Executed(sched, true, "");
        warpAndExecute(when);
        assertEq(counter.hits(), 1);
        assertTrue(hss.get(sched).executed);
        warpAndExecute(when + 1);
        assertEq(counter.hits(), 1);
    }

    function test_executeDue_skipsFutureSchedules() public {
        HederaHarness.schedule(address(counter), when, GAS, data);
        HederaHarness.schedule(address(counter), when + 100, GAS, data);
        warpAndExecute(when);
        assertEq(counter.hits(), 1);
        warpAndExecute(when + 100);
        assertEq(counter.hits(), 2);
    }

    function test_executeDue_beforeDue_doesNothing() public {
        HederaHarness.schedule(address(counter), when, GAS, data);
        executeDueSchedules();
        assertEq(counter.hits(), 0);
    }

    function test_executeDue_skipsDeleted() public {
        (address sched,) = HederaHarness.schedule(address(counter), when, GAS, data);
        assertEq(HederaHarness.deleteSchedule(sched), HederaHarness.SUCCESS);
        warpAndExecute(when);
        assertEq(counter.hits(), 0);
    }

    function test_execute_firesRegardlessOfTime() public {
        (address sched,) = HederaHarness.schedule(address(counter), T0 + 30 days, GAS, data);
        hss.execute(sched);
        assertEq(counter.hits(), 1);
        vm.expectRevert(abi.encodeWithSelector(MockHSS.NotPending.selector, sched));
        hss.execute(sched);
        vm.expectRevert(abi.encodeWithSelector(MockHSS.UnknownSchedule.selector, address(0xDEAD)));
        hss.execute(address(0xDEAD));
    }

    function test_execute_recordsFailedCall() public {
        (address sched,) = HederaHarness.schedule(address(counter), when, GAS, hex"deadbeef");
        vm.expectEmit(true, true, true, true, address(hss));
        emit MockHSS.Executed(sched, false, "");
        warpAndExecute(when);
        assertTrue(hss.get(sched).executed);
        assertEq(counter.hits(), 0);
    }

    function test_deleteSchedule_codes() public {
        assertEq(HederaHarness.deleteSchedule(address(0xDEAD)), HederaHarness.INVALID_SCHEDULE_ID);
        (address a,) = HederaHarness.schedule(address(counter), when, GAS, data);
        assertEq(HederaHarness.deleteSchedule(a), HederaHarness.SUCCESS);
        assertEq(HederaHarness.deleteSchedule(a), HederaHarness.SCHEDULE_ALREADY_DELETED);
        (address b,) = HederaHarness.schedule(address(counter), when, GAS, data);
        hss.execute(b);
        assertEq(HederaHarness.deleteSchedule(b), HederaHarness.SCHEDULE_ALREADY_EXECUTED);
    }

    function test_nestedSchedule_blocked_returns373() public {
        counter.setReschedule(true);
        hss.setBlockNested(true);
        HederaHarness.schedule(address(counter), when, GAS, data);
        warpAndExecute(when);
        assertEq(counter.hits(), 1);
        assertEq(counter.lastRc(), HederaHarness.NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION);
        assertEq(counter.lastSchedule(), address(0));
        assertEq(hss.count(), 1);
    }

    function test_nestedSchedule_allowedByDefault_chains() public {
        counter.setReschedule(true);
        HederaHarness.schedule(address(counter), when, GAS, data);
        warpAndExecute(when);
        assertEq(counter.lastRc(), HederaHarness.SUCCESS);
        assertEq(counter.lastSchedule(), address(0x5c4ed001));
        assertEq(hss.count(), 2);
        warpAndExecute(when + 10);
        assertEq(counter.hits(), 2);
        assertEq(hss.count(), 3);
    }

    function test_blockNested_onlyAffectsCallsDuringExecution() public {
        hss.setBlockNested(true);
        (, int64 rc) = HederaHarness.schedule(address(counter), when, GAS, data);
        assertEq(rc, HederaHarness.SUCCESS);
    }

    // ---- HTS ----

    function test_associate_idempotent() public {
        address token = address(0x70);
        assertEq(counter.associate(token), HederaHarness.SUCCESS);
        assertTrue(hts.associated(address(counter), token));
        assertEq(hts.associateToken(address(counter), token), HederaHarness.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT);
        assertEq(counter.associate(token), HederaHarness.SUCCESS);
    }

    function test_htsTransfer_requiresRecipientAssociation() public {
        address token = address(0x70);
        address bob = address(0xB0B);
        assertEq(counter.send(token, bob, 5), 184);
        assertEq(hts.transferCount(), 0);
        hts.associateToken(bob, token);
        assertEq(counter.send(token, bob, 5), HederaHarness.SUCCESS);
        assertEq(hts.transferCount(), 1);
        (address t, address from, address to, uint256 amount) = hts.transfers(0);
        assertEq(t, token);
        assertEq(from, address(counter));
        assertEq(to, bob);
        assertEq(amount, 5);
    }

    function test_htsTransferFrom_records() public {
        address token = address(0x70);
        assertEq(hts.transferFrom(token, address(1), address(2), 7), 184);
        hts.associateToken(address(2), token);
        assertEq(hts.transferFrom(token, address(1), address(2), 7), HederaHarness.SUCCESS);
        assertEq(hts.transferCount(), 1);
    }

    // ---- helpers ----

    function _candidate(bytes32 seed, uint256 i) internal view returns (uint256) {
        // forge-lint: disable-next-line(incorrect-shift)
        uint256 base = 1 << i;
        return when + base + uint16(uint256(keccak256(abi.encodePacked(uint256(seed), i)))) % base;
    }
}
