// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {BondDeskTest} from "./Base.t.sol";
import {BondRegistry} from "../src/BondRegistry.sol";

contract BondRegistryTest is BondDeskTest {
    uint64 internal maturity;

    function setUp() public override {
        super.setUp();
        maturity = uint64(token.getMaturityDate());
    }

    function _register(
        address t,
        address s,
        uint256 face,
        uint256 bps,
        uint64 interval,
        uint64 first,
        uint64 mat
    ) internal returns (uint256) {
        vm.prank(issuer);
        return registry.register(t, s, face, bps, interval, first, mat);
    }

    function test_register_storesTerms() public view {
        assertEq(registry.bondCount(), 1);
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        assertEq(t.token, address(token));
        assertEq(t.settlement, address(usdc));
        assertEq(t.issuer, issuer);
        assertEq(t.bondDecimals, 0);
        assertEq(t.settlementDecimals, 6);
        assertEq(t.faceValue, 1e6);
        assertEq(t.couponRateBps, 500);
        assertEq(t.couponInterval, 30 days);
        assertEq(t.nextCoupon, START + 1 days);
        assertEq(t.maturity, maturity);
        assertEq(uint8(t.status), uint8(BondRegistry.Status.Active));
    }

    function test_register_emitsAndIncrementsIds() public {
        vm.expectEmit(address(registry));
        emit BondRegistry.BondRegistered(2, address(token), issuer, address(usdc));
        uint256 id = _register(address(token), address(usdc), 1e6, 500, 30 days, uint64(block.timestamp + 1 days), maturity);
        assertEq(id, 2);
        assertEq(registry.bondCount(), 2);
        assertEq(registry.terms(2).issuer, issuer);
    }

    function test_register_revert_notIssuer() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, inv1, registry.ISSUER_ROLE())
        );
        vm.prank(inv1);
        registry.register(address(token), address(usdc), 1e6, 500, 30 days, uint64(block.timestamp + 1 days), maturity);
    }

    function test_register_revert_invalidTerms() public {
        uint64 first = uint64(block.timestamp + 1 days);
        uint64 now_ = uint64(block.timestamp);
        bytes memory err = abi.encodeWithSelector(BondRegistry.InvalidTerms.selector);
        vm.expectRevert(err);
        _register(address(0), address(usdc), 1e6, 500, 30 days, first, maturity); // token
        vm.expectRevert(err);
        _register(address(token), address(0), 1e6, 500, 30 days, first, maturity); // settlement
        vm.expectRevert(err);
        _register(address(token), address(usdc), 0, 500, 30 days, first, maturity); // faceValue
        vm.expectRevert(err);
        _register(address(token), address(usdc), 1e6, 500, 0, first, maturity); // couponInterval
        vm.expectRevert(err);
        _register(address(token), address(usdc), 1e6, 500, 30 days, maturity + 1, maturity); // firstCoupon > maturity
        vm.expectRevert(err);
        _register(address(token), address(usdc), 1e6, 500, 30 days, now_, now_); // maturity <= now
        vm.expectRevert(err);
        _register(address(token), address(usdc), 1e6, 10_001, 30 days, first, maturity); // couponRateBps
        assertEq(registry.bondCount(), 1);
        // boundaries that are valid
        assertEq(_register(address(token), address(usdc), 1e6, 10_000, 1, maturity, maturity), 2);
        assertEq(_register(address(token), address(usdc), 1, 0, 30 days, 0, now_ + 1), 3);
    }

    function test_status_unknownReturnsNone() public view {
        assertEq(uint8(registry.status(0)), uint8(BondRegistry.Status.None));
        assertEq(uint8(registry.status(99)), uint8(BondRegistry.Status.None));
    }

    function test_terms_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 0));
        registry.terms(0);
        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 2));
        registry.terms(2);
    }

    function test_setStatus_gateOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, registry.GATE_ROLE())
        );
        vm.prank(admin);
        registry.setStatus(bondId, BondRegistry.Status.Frozen);

        _grantGate(relayer);
        vm.expectEmit(address(registry));
        emit BondRegistry.StatusChanged(bondId, BondRegistry.Status.Active, BondRegistry.Status.Frozen);
        vm.prank(relayer);
        registry.setStatus(bondId, BondRegistry.Status.Frozen);
        assertEq(uint8(registry.status(bondId)), uint8(BondRegistry.Status.Frozen));

        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 2));
        vm.prank(relayer);
        registry.setStatus(2, BondRegistry.Status.Frozen);
    }

    function test_setNextCoupon_gateOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, issuer, registry.GATE_ROLE())
        );
        vm.prank(issuer);
        registry.setNextCoupon(bondId, 123);

        _grantGate(relayer);
        vm.expectEmit(address(registry));
        emit BondRegistry.NextCouponSet(bondId, 123);
        vm.prank(relayer);
        registry.setNextCoupon(bondId, 123);
        assertEq(registry.terms(bondId).nextCoupon, 123);

        vm.expectRevert(abi.encodeWithSelector(BondRegistry.UnknownBond.selector, 0));
        vm.prank(relayer);
        registry.setNextCoupon(0, 1);
    }

    function test_isAdmin_isIssuer() public view {
        assertTrue(registry.isAdmin(admin));
        assertFalse(registry.isAdmin(issuer));
        assertTrue(registry.isIssuer(bondId, issuer));
        assertFalse(registry.isIssuer(bondId, inv1));
        assertFalse(registry.isIssuer(2, issuer));
        assertFalse(registry.isIssuer(2, address(0)));
    }
}
