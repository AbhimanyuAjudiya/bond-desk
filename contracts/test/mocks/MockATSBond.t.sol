// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondDeskTest} from "../Base.t.sol";
import {MockATSBond} from "../../src/mocks/MockATSBond.sol";
import {IATSBond} from "../../src/interfaces/IATSBond.sol";
import {IATSAdmin} from "ats/IATSAdmin.sol";
import {IATSFactory} from "ats/IATSFactory.sol";
import {
    ROLE_ISSUER,
    ROLE_KYC,
    ROLE_SSI_MANAGER,
    ROLE_SNAPSHOT,
    ROLE_MATURITY_REDEEMER,
    ROLE_INTEREST_RATE_MANAGER,
    BOND_CONFIG_ID,
    DEFAULT_PARTITION
} from "ats/ATSRoles.sol";

contract MockATSBondTest is BondDeskTest {
    IATSBond internal bond; // the mock through the production interfaces
    IATSAdmin internal ats;

    function setUp() public override {
        super.setUp();
        bond = IATSBond(address(token));
        ats = IATSAdmin(address(token));
    }

    function _check(address operator, address from, address to, uint256 value, bool ok, bytes1 code, bytes4 reason)
        internal
    {
        vm.prank(operator);
        (bool ok_, bytes1 code_, bytes32 reason_) = bond.canTransferFrom(from, to, value, "");
        assertEq(ok_, ok, "ok");
        assertEq(uint8(code_), uint8(code), "code");
        assertEq(reason_, bytes32(reason), "reason");
    }

    function test_canTransferFrom_codesPerRejection() public {
        _check(issuer, issuer, inv1, 10, true, 0x01, 0);
        _check(relayer, issuer, inv1, 10, false, 0x54, MockATSBond.InsufficientAllowance.selector); // operator, no allowance
        vm.prank(issuer);
        token.approve(relayer, 10);
        _check(relayer, issuer, inv1, 10, true, 0x01, 0);
        _check(issuer, issuer, inv1, 101, false, 0x54, MockATSBond.InsufficientBalance.selector);
        _check(issuer, issuer, inv3, 10, false, 0x10, MockATSBond.InvalidKycStatus.selector); // to not KYC'd
        _check(inv3, inv3, inv1, 0, false, 0x10, MockATSBond.InvalidKycStatus.selector); // from not KYC'd
        token.setAddressFrozen(inv1, true);
        _check(issuer, issuer, inv1, 10, false, 0x10, MockATSBond.AccountIsBlocked.selector); // to frozen
        _check(inv1, inv1, issuer, 0, false, 0x10, MockATSBond.AccountIsBlocked.selector); // from frozen
        token.pause();
        _check(issuer, issuer, inv1, 10, false, 0x42, MockATSBond.IsPaused.selector);
    }

    function test_canTransferFrom_precedence() public {
        // paused > frozen > kyc > allowance > balance
        token.setAddressFrozen(inv3, true);
        token.pause();
        _check(relayer, inv3, issuer, 1000, false, 0x42, MockATSBond.IsPaused.selector);
        token.unpause();
        _check(relayer, inv3, issuer, 1000, false, 0x10, MockATSBond.AccountIsBlocked.selector);
        token.setAddressFrozen(inv3, false);
        _check(relayer, inv3, issuer, 1000, false, 0x10, MockATSBond.InvalidKycStatus.selector);
        _kyc(inv3);
        _check(relayer, inv3, issuer, 1000, false, 0x54, MockATSBond.InsufficientAllowance.selector);
        vm.prank(inv3);
        token.approve(relayer, 1000);
        _check(relayer, inv3, issuer, 1000, false, 0x54, MockATSBond.InsufficientBalance.selector);
        _check(inv3, inv3, issuer, 1000, false, 0x54, MockATSBond.InsufficientBalance.selector); // self: allowance skipped
    }

    function test_transfers_revertWithMatchingErrors() public {
        vm.prank(issuer);
        token.approve(relayer, 5);
        vm.expectRevert(abi.encodeWithSelector(MockATSBond.InsufficientAllowance.selector, relayer, issuer));
        vm.prank(relayer);
        token.transferFrom(issuer, inv1, 6);

        vm.expectRevert(
            abi.encodeWithSelector(MockATSBond.InsufficientBalance.selector, issuer, 100, 101, DEFAULT_PARTITION)
        );
        vm.prank(issuer);
        token.transfer(inv1, 101);

        vm.expectRevert(MockATSBond.InvalidKycStatus.selector);
        vm.prank(issuer);
        token.transfer(inv3, 1);

        token.setAddressFrozen(inv1, true);
        vm.expectRevert(abi.encodeWithSelector(MockATSBond.AccountIsBlocked.selector, inv1));
        vm.prank(issuer);
        token.transfer(inv1, 1);
        token.setAddressFrozen(inv1, false);

        token.setAddressFrozen(issuer, true);
        vm.expectRevert(abi.encodeWithSelector(MockATSBond.AccountIsBlocked.selector, issuer));
        vm.prank(issuer);
        token.transfer(inv1, 1);
        token.setAddressFrozen(issuer, false);

        token.pause();
        vm.expectRevert(MockATSBond.IsPaused.selector);
        vm.prank(issuer);
        token.transfer(inv1, 1);
        token.unpause();

        vm.prank(relayer);
        assertTrue(token.transferFrom(issuer, inv1, 5));
        assertEq(token.balanceOf(inv1), 5);
        assertEq(token.allowance(issuer, relayer), 0);
    }

    function test_mint_requiresKyc() public {
        vm.expectRevert(MockATSBond.InvalidKycStatus.selector);
        token.mint(inv3, 1);
        token.mint(inv1, 7);
        assertEq(token.balanceOf(inv1), 7);
        assertEq(token.totalSupply(), 107);
    }

    function test_snapshots_lazyCheckpoints() public {
        assertEq(bond.takeSnapshot(), 1);
        assertEq(bond.balanceOfAtSnapshot(1, issuer), 100); // no checkpoint yet -> current
        assertEq(bond.totalSupplyAtSnapshot(1), 100);

        vm.prank(issuer);
        token.transfer(inv1, 10);
        assertEq(bond.balanceOfAtSnapshot(1, issuer), 100); // checkpoint written before the move
        assertEq(bond.balanceOfAtSnapshot(1, inv1), 0);
        assertEq(token.balanceOf(issuer), 90);

        assertEq(bond.takeSnapshot(), 2);
        assertEq(bond.takeSnapshot(), 3); // consecutive snapshots without balance changes
        vm.prank(inv1);
        token.transfer(inv2, 4);
        token.mint(inv2, 50);

        assertEq(bond.balanceOfAtSnapshot(1, inv1), 0);
        assertEq(bond.balanceOfAtSnapshot(2, inv1), 10);
        assertEq(bond.balanceOfAtSnapshot(3, inv1), 10);
        assertEq(bond.balanceOfAtSnapshot(3, inv2), 0);
        assertEq(bond.balanceOfAtSnapshot(2, issuer), 90);
        assertEq(bond.totalSupplyAtSnapshot(1), 100);
        assertEq(bond.totalSupplyAtSnapshot(3), 100);
        assertEq(bond.balanceOfAtSnapshot(4, inv2), 54); // no later checkpoint -> current
        assertEq(bond.totalSupplyAtSnapshot(4), 150);
        assertEq(token.currentSnapshotId(), 3);
    }

    function testFuzz_snapshot_balancesSumToSupply(uint8 a, uint8 b, uint8 c) public {
        uint256 id = bond.takeSnapshot();
        vm.prank(issuer);
        token.transfer(inv1, uint256(a) % 101);
        uint256 bal1 = token.balanceOf(inv1);
        vm.prank(inv1);
        token.transfer(inv2, uint256(b) % (bal1 + 1));
        token.mint(inv2, c);
        assertEq(
            bond.balanceOfAtSnapshot(id, issuer) + bond.balanceOfAtSnapshot(id, inv1) + bond.balanceOfAtSnapshot(id, inv2),
            100
        );
        assertEq(bond.totalSupplyAtSnapshot(id), 100);
        assertEq(token.balanceOf(issuer) + token.balanceOf(inv1) + token.balanceOf(inv2), 100 + uint256(c));
    }

    function test_fullRedeemAtMaturity() public {
        vm.prank(issuer);
        token.transfer(inv1, 10);
        vm.expectRevert(MockATSBond.NotMatured.selector);
        bond.fullRedeemAtMaturity(inv1);

        vm.warp(bond.getMaturityDate());
        token.revokeKyc(inv1);
        vm.expectRevert(MockATSBond.InvalidKycStatus.selector);
        bond.fullRedeemAtMaturity(inv1);

        _kyc(inv1);
        uint256 id = bond.takeSnapshot();
        bond.fullRedeemAtMaturity(inv1);
        assertEq(token.balanceOf(inv1), 0);
        assertEq(token.totalSupply(), 90);
        assertEq(bond.balanceOfAtSnapshot(id, inv1), 10);
        assertEq(bond.totalSupplyAtSnapshot(id), 100);
        bond.fullRedeemAtMaturity(inv1); // zero balance is a no-op, like ATS skipping empty partitions
    }

    /// @dev Every IATSBond / IATSAdmin function is called through the interface type: the ABI check for the mock.
    function test_interfaces_abiCompatible() public {
        assertEq(bond.decimals(), 0);
        assertEq(bond.totalSupply(), 100);
        assertEq(ats.totalSupply(), 100);
        assertEq(bond.balanceOf(issuer), 100);
        assertEq(ats.balanceOf(issuer), 100);
        assertEq(bond.getMaturityDate(), START + 365 days);
        assertEq(ats.getMaturityDate(), START + 365 days);

        assertFalse(ats.hasRole(ROLE_SNAPSHOT, relayer));
        assertTrue(ats.grantRole(ROLE_SNAPSHOT, relayer));
        assertTrue(ats.hasRole(ROLE_SNAPSHOT, relayer));
        assertTrue(ats.revokeRole(ROLE_SNAPSHOT, relayer));
        assertFalse(ats.hasRole(ROLE_SNAPSHOT, relayer));

        assertTrue(ats.isIssuer(issuer));
        assertFalse(ats.isIssuer(officer));
        assertTrue(ats.addIssuer(officer));
        assertTrue(ats.isIssuer(officer));

        assertEq(ats.getKycStatusFor(inv3), 0);
        assertEq(bond.getKycStatusFor(inv1), 1);
        assertTrue(ats.grantKyc(inv3, "vc:3", block.timestamp, block.timestamp + 1 days, issuer));
        assertEq(ats.getKycStatusFor(inv3), 1);
        assertTrue(ats.revokeKyc(inv3));
        assertEq(bond.getKycStatusFor(inv3), 0);

        assertFalse(bond.paused());
        assertTrue(ats.pause());
        assertTrue(ats.paused());
        assertTrue(ats.unpause());
        assertFalse(bond.paused());

        ats.mint(inv1, 1);
        assertEq(ats.balanceOf(inv1), 1);

        assertFalse(bond.isFrozen(inv1));
        ats.setAddressFrozen(inv1, true);
        assertTrue(bond.isFrozen(inv1));

        ats.setRate(500, 4);
        assertEq(token.rate(), 500);
        assertEq(token.rateDecimals(), 4);

        assertEq(bond.allowance(issuer, relayer), 0);
        vm.prank(issuer);
        assertTrue(bond.approve(relayer, 3));
        assertEq(bond.allowance(issuer, relayer), 3);
        vm.prank(relayer);
        assertTrue(bond.transferFrom(issuer, inv2, 3));
        assertEq(bond.balanceOf(inv2), 3);
    }

    /// @dev Guards the vendored ATS constants and the hand-flattened factory ABI against typos.
    function test_atsConstants_matchUpstream() public view {
        assertEq(ROLE_ISSUER, keccak256("asset.tokenization.standard.role.Issuer"));
        assertEq(ROLE_KYC, keccak256("asset.tokenization.standard.role.Kyc"));
        assertEq(ROLE_SSI_MANAGER, keccak256("asset.tokenization.standard.role.SsiManager"));
        assertEq(ROLE_SNAPSHOT, keccak256("asset.tokenization.standard.role.Snapshot"));
        assertEq(ROLE_MATURITY_REDEEMER, keccak256("asset.tokenization.standard.role.MaturityRedeemer"));
        assertEq(ROLE_INTEREST_RATE_MANAGER, keccak256("asset.tokenization.standard.role.InterestRateManager"));
        assertEq(BOND_CONFIG_ID, bytes32(uint256(2)));
        assertEq(DEFAULT_PARTITION, token.DEFAULT_PARTITION());
        // deployBond(((address,uint256,(bytes32,uint256),(string,string,string,uint8),(bytes32,address[])[],address[],
        //   address[],address[],address,address,bool,bool,bool,bool,bool,bool,bool),(bytes3,uint256,uint8,uint256,uint256),
        //   address[],bytes[]),(uint8,uint8,(bool,string,string)))
        assertEq(IATSFactory.deployBond.selector, bytes4(0x29002951));
        assertEq(IATSBond.canTransferFrom.selector, bytes4(0x122eb575));
        assertEq(IATSAdmin.grantKyc.selector, bytes4(0x81bea54d));
        assertEq(MockATSBond.AccountIsBlocked.selector, bytes4(0x796c1f0d));
        assertEq(MockATSBond.InsufficientAllowance.selector, bytes4(0xf180d8f9));
        assertEq(MockATSBond.InsufficientBalance.selector, bytes4(0x5d6824c4));
        assertEq(MockATSBond.IsPaused.selector, bytes4(0x1309a563));
        assertEq(MockATSBond.InvalidKycStatus.selector, bytes4(0xfc855b1b));
    }
}
