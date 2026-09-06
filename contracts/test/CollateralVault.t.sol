// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondDeskTest} from "./Base.t.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {RegistryAuth} from "../src/RegistryAuth.sol";
import {NavOracle} from "../src/NavOracle.sol";
import {CollateralVault} from "../src/CollateralVault.sol";

/// @dev Token holder with no receive(): HBAR sends to it fail.
contract Rejector {}

contract CollateralVaultTest is BondDeskTest {
    CollateralVault internal vault;
    address internal gate = makeAddr("gate");
    uint256 internal constant HUNDRED = 100 * 1e8; // 100 HBAR in tinybar

    function _deployExtensions() internal override {
        vault = new CollateralVault(registry, oracle, 300);
        _grantGate(gate);
        vm.deal(issuer, hbar(1_000));
    }

    function _deposit(uint256 amount) internal {
        vm.prank(issuer);
        vault.deposit{value: amount}(bondId);
    }

    function _setStatus(BondRegistry.Status s) internal {
        vm.prank(gate);
        registry.setStatus(bondId, s);
    }

    function _seize() internal {
        vm.prank(gate);
        vault.seize(bondId);
    }

    /// @dev Warp to maturity, burn the whole supply (issuer holds all 100), then refresh the feed.
    function _matureAndRedeemAll() internal {
        vm.warp(token.getMaturityDate());
        token.fullRedeemAtMaturity(issuer);
        feed.setAnswer(5_000_000);
        assertEq(token.totalSupply(), 0);
    }

    function _badStatus(BondRegistry.Status s) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(CollateralVault.BadStatus.selector, s);
    }

    // ------------------------------------------------------------------ setup

    function test_constructor_storesConfig() public view {
        assertEq(vault.NATIVE_DECIMALS(), 8);
        assertEq(address(vault.oracle()), address(oracle));
        assertEq(address(vault.registry()), address(registry));
        assertEq(vault.minCoverageBps(), 300);
    }

    function test_setMinCoverage_onlyAdmin() public {
        vm.prank(issuer);
        vm.expectRevert(RegistryAuth.NotAdmin.selector);
        vault.setMinCoverage(1000);

        vm.expectEmit(true, true, true, true, address(vault));
        emit CollateralVault.MinCoverageSet(1000);
        vm.prank(admin);
        vault.setMinCoverage(1000);
        assertEq(vault.minCoverageBps(), 1000);
    }

    // ---------------------------------------------------------------- deposit

    function test_deposit_onlyIssuer() public {
        vm.deal(inv1, 1e8);
        vm.prank(inv1);
        vm.expectRevert(RegistryAuth.NotIssuer.selector);
        vault.deposit{value: 1e8}(bondId);

        vm.expectEmit(true, true, true, true, address(vault));
        emit CollateralVault.Deposited(bondId, issuer, HUNDRED);
        _deposit(HUNDRED);
        assertEq(vault.collateral(bondId), HUNDRED);
        assertEq(address(vault).balance, HUNDRED);
    }

    function test_deposit_allowedWhenFrozen() public {
        _setStatus(BondRegistry.Status.Frozen);
        _deposit(HUNDRED);
        assertEq(vault.collateral(bondId), HUNDRED);
    }

    function test_deposit_revertsWhenDefaulted() public {
        _setStatus(BondRegistry.Status.Defaulted);
        vm.prank(issuer);
        vm.expectRevert(_badStatus(BondRegistry.Status.Defaulted));
        vault.deposit{value: HUNDRED}(bondId);

        _setStatus(BondRegistry.Status.Matured);
        vm.prank(issuer);
        vm.expectRevert(_badStatus(BondRegistry.Status.Matured));
        vault.deposit{value: HUNDRED}(bondId);
    }

    function test_deposit_revertsZeroValue() public {
        vm.prank(issuer);
        vm.expectRevert(CollateralVault.BadAmount.selector);
        vault.deposit{value: 0}(bondId);
    }

    function test_receive_reverts() public {
        vm.deal(address(this), 1e8);
        (bool ok, bytes memory data) = address(vault).call{value: 1e8}("");
        assertFalse(ok);
        assertEq(data, abi.encodeWithSelector(CollateralVault.DirectDepositNotAllowed.selector));
        assertEq(address(vault).balance, 0);
    }

    // --------------------------------------------------------------- coverage

    function test_coverageBps_math() public {
        // 100 HBAR = 1e10 tinybar @ $0.05 = $5 = 5e6 USDC; principal 100 tokens x $1 = 1e8 USDC -> 500 bps
        _deposit(HUNDRED);
        assertEq(vault.coverageBps(bondId), 500);
        feed.setAnswer(10_000_000); // $0.10 -> 1000 bps
        assertEq(vault.coverageBps(bondId), 1000);
        assertEq(vault.coverageBps(bondId), HUNDRED * 10_000_000 * 1e6 / 1e16 * 10_000 / (100 * 1e6));
    }

    function test_coverageBps_maxWhenNoSupply() public {
        _matureAndRedeemAll();
        assertEq(vault.coverageBps(bondId), type(uint256).max);
        _setStatus(BondRegistry.Status.Frozen); // deposit still allowed; still max with collateral
        _deposit(HUNDRED);
        assertEq(vault.coverageBps(bondId), type(uint256).max);
    }

    function test_coverageBps_revertsUnknownBond() public {
        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 999));
        vault.coverageBps(999);
    }

    function test_coverageBps_revertsStaleFeed() public {
        _deposit(HUNDRED);
        vm.warp(START + 90_001);
        vm.expectRevert(abi.encodeWithSelector(NavOracle.StaleFeed.selector, START, 90_000));
        vault.coverageBps(bondId);
    }

    // --------------------------------------------------------------- withdraw

    function test_withdraw_okAboveMin() public {
        _deposit(HUNDRED);
        uint256 before = issuer.balance;
        vm.expectEmit(true, true, true, true, address(vault));
        emit CollateralVault.Withdrawn(bondId, issuer, 30e8);
        vm.prank(issuer);
        vault.withdraw(bondId, 30e8);
        assertEq(vault.collateral(bondId), 70e8);
        assertEq(issuer.balance, before + 30e8);
        assertEq(vault.coverageBps(bondId), 350);

        vm.prank(issuer);
        vault.withdraw(bondId, 10e8); // lands exactly on the minimum
        assertEq(vault.coverageBps(bondId), 300);
    }

    function test_withdraw_revertsBelowMin() public {
        _deposit(HUNDRED);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(CollateralVault.CoverageTooLow.selector, 250, 300));
        vault.withdraw(bondId, 50e8);
        assertEq(vault.collateral(bondId), HUNDRED);
    }

    function test_withdraw_revertsWhenFrozen() public {
        _deposit(HUNDRED);
        _setStatus(BondRegistry.Status.Frozen);
        vm.prank(issuer);
        vm.expectRevert(_badStatus(BondRegistry.Status.Frozen));
        vault.withdraw(bondId, 1);

        _setStatus(BondRegistry.Status.Defaulted);
        vm.prank(issuer);
        vm.expectRevert(_badStatus(BondRegistry.Status.Defaulted));
        vault.withdraw(bondId, 1);
    }

    function test_withdraw_onlyIssuer() public {
        _deposit(HUNDRED);
        vm.prank(inv1);
        vm.expectRevert(RegistryAuth.NotIssuer.selector);
        vault.withdraw(bondId, 1);
    }

    function test_withdraw_revertsBadAmount() public {
        _deposit(HUNDRED);
        vm.prank(issuer);
        vm.expectRevert(CollateralVault.BadAmount.selector);
        vault.withdraw(bondId, HUNDRED + 1);
        vm.prank(issuer);
        vm.expectRevert(CollateralVault.BadAmount.selector);
        vault.withdraw(bondId, 0);
    }

    function test_withdraw_revertsWhenSeized() public {
        _deposit(HUNDRED);
        _seize(); // status untouched: the seized check must fire on its own
        vm.prank(issuer);
        vm.expectRevert(CollateralVault.AlreadySeized.selector);
        vault.withdraw(bondId, 1);
    }

    function test_withdraw_revertsSendFailed() public {
        _deposit(HUNDRED);
        vm.etch(issuer, address(new Rejector()).code); // issuer becomes a contract that rejects HBAR
        vm.prank(issuer);
        vm.expectRevert(CollateralVault.SendFailed.selector);
        vault.withdraw(bondId, 30e8);
        assertEq(vault.collateral(bondId), HUNDRED); // whole call reverted: accounting untouched
        assertEq(address(vault).balance, HUNDRED);
    }

    function test_withdraw_allowedWhenMaturedAndSupplyZero() public {
        _deposit(HUNDRED);
        _matureAndRedeemAll();
        _setStatus(BondRegistry.Status.Matured);
        uint256 before = issuer.balance;
        vm.prank(issuer);
        vault.withdraw(bondId, HUNDRED);
        assertEq(vault.collateral(bondId), 0);
        assertEq(issuer.balance, before + HUNDRED);
        assertEq(address(vault).balance, 0);
    }

    // ------------------------------------------------------------------ seize

    function test_seize_onlyGate() public {
        _deposit(HUNDRED);
        vm.prank(issuer);
        vm.expectRevert(RegistryAuth.NotGate.selector);
        vault.seize(bondId);
        vm.prank(admin);
        vm.expectRevert(RegistryAuth.NotGate.selector);
        vault.seize(bondId);
    }

    function test_seize_snapshotsAndZeroesCollateral() public {
        _deposit(HUNDRED);
        vm.expectEmit(true, true, true, true, address(vault));
        emit CollateralVault.Seized(bondId, 1, HUNDRED);
        _seize();
        (uint256 snapshotId, uint256 amount) = vault.seizures(bondId);
        assertEq(snapshotId, 1);
        assertEq(amount, HUNDRED);
        assertEq(token.currentSnapshotId(), 1);
        assertEq(vault.collateral(bondId), 0);
        assertEq(address(vault).balance, HUNDRED); // locked for claims, not moved
    }

    function test_seize_revertsUnknownBond() public {
        vm.prank(gate);
        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 999));
        vault.seize(999);
    }

    function test_seize_revertsTwice() public {
        _deposit(HUNDRED);
        _seize();
        vm.prank(gate);
        vm.expectRevert(CollateralVault.AlreadySeized.selector);
        vault.seize(bondId);
    }

    // ------------------------------------------------------------ claimSeized

    function _distributeAndSeize() internal {
        _deposit(HUNDRED);
        vm.startPrank(issuer);
        token.transfer(inv1, 30);
        token.transfer(inv2, 20);
        vm.stopPrank();
        _seize();
    }

    function test_claimSeized_proRata() public {
        _distributeAndSeize();
        vm.prank(inv1);
        token.transfer(inv2, 30); // post-seizure moves do not change entitlements

        uint256 b1 = inv1.balance;
        uint256 b2 = inv2.balance;
        uint256 bi = issuer.balance;

        vm.expectEmit(true, true, true, true, address(vault));
        emit CollateralVault.SeizedClaimed(bondId, inv1, 30e8);
        vm.prank(inv1);
        vault.claimSeized(bondId);
        vm.prank(inv2);
        vault.claimSeized(bondId);
        vm.prank(issuer);
        vault.claimSeized(bondId);

        assertEq(inv1.balance - b1, 30e8);
        assertEq(inv2.balance - b2, 20e8);
        assertEq(issuer.balance - bi, 50e8);
        assertTrue(vault.claimed(bondId, inv1));
        assertTrue(vault.claimed(bondId, inv2));
        assertTrue(vault.claimed(bondId, issuer));
        assertEq(address(vault).balance, 0);
    }

    function test_claimSeized_revertsTwice() public {
        _distributeAndSeize();
        vm.prank(inv1);
        vault.claimSeized(bondId);
        vm.prank(inv1);
        vm.expectRevert(CollateralVault.AlreadyClaimed.selector);
        vault.claimSeized(bondId);
    }

    function test_claimSeized_revertsNotSeized() public {
        _deposit(HUNDRED);
        vm.prank(issuer);
        vm.expectRevert(CollateralVault.NotSeized.selector);
        vault.claimSeized(bondId);
    }

    function test_claimSeized_revertsNothingToClaim() public {
        _distributeAndSeize();
        vm.prank(inv3); // never held tokens
        vm.expectRevert(CollateralVault.NothingToClaim.selector);
        vault.claimSeized(bondId);
    }

    function test_claimSeized_revertsSendFailed() public {
        Rejector r = new Rejector();
        _kyc(address(r));
        vm.prank(issuer);
        token.transfer(address(r), 10);
        _deposit(HUNDRED);
        _seize();
        vm.prank(address(r));
        vm.expectRevert(CollateralVault.SendFailed.selector);
        vault.claimSeized(bondId);
        assertFalse(vault.claimed(bondId, address(r)));
    }

    /// @dev Invariant: sum of claims <= seized amount (rounding dust stays in the vault, < 1 tinybar per holder).
    function testFuzz_claimSeized_sumLeSeized(uint256 amount, uint256 a1, uint256 a2) public {
        amount = bound(amount, 1, hbar(1_000));
        a1 = bound(a1, 0, 100);
        a2 = bound(a2, 0, 100 - a1);
        _deposit(amount);
        vm.startPrank(issuer);
        if (a1 > 0) token.transfer(inv1, a1);
        if (a2 > 0) token.transfer(inv2, a2);
        vm.stopPrank();
        _seize();

        address[3] memory holders = [inv1, inv2, issuer];
        uint256 sum;
        for (uint256 i; i < holders.length; ++i) {
            uint256 before = holders[i].balance;
            vm.prank(holders[i]);
            try vault.claimSeized(bondId) {
                sum += holders[i].balance - before;
            } catch {}
        }
        assertLe(sum, amount);
        assertLe(amount - sum, 2);
        assertEq(address(vault).balance, amount - sum);
    }
}
