// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondDeskTest} from "./Base.t.sol";
import {BondMarket} from "../src/BondMarket.sol";
import {BondRegistry} from "../src/BondRegistry.sol";
import {RegistryAuth} from "../src/RegistryAuth.sol";
import {MockATSBond} from "../src/mocks/MockATSBond.sol";
import {IATSBond} from "../src/interfaces/IATSBond.sol";

contract BondMarketTest is BondDeskTest {
    uint128 internal constant PX = 990_000; // 0.99 USDC per whole bond (decimals 0)

    BondMarket internal market;
    address internal treasury = makeAddr("treasury");

    function _deployExtensions() internal override {
        market = new BondMarket(registry, oracle, treasury, 0);
        _grantGate(address(this));
        address[4] memory all = [issuer, inv1, inv2, inv3];
        for (uint256 i; i < all.length; ++i) {
            vm.startPrank(all[i]);
            token.approve(address(market), type(uint256).max);
            usdc.approve(address(market), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _sell(uint128 amount, uint128 price, uint64 expiry) internal returns (uint256 id) {
        vm.prank(issuer);
        id = market.place(bondId, true, amount, price, expiry);
    }

    function _buy(address maker, uint128 amount, uint128 price) internal returns (uint256 id) {
        vm.prank(maker);
        id = market.place(bondId, false, amount, price, 0);
    }

    function _fill(address taker, uint256 id, uint128 amount) internal {
        vm.prank(taker);
        market.fill(id, amount);
    }

    function _rejected(bytes1 code, bytes4 sel) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(BondMarket.ComplianceRejected.selector, code, bytes32(sel));
    }

    // ------------------------------------------------------------------ place

    function test_place_emitsAndStores() public {
        uint64 expiry = uint64(block.timestamp + 7 days);
        vm.expectEmit(address(market));
        emit BondMarket.OrderPlaced(1, bondId, issuer, true, 20, PX, expiry);
        uint256 id = _sell(20, PX, expiry);
        assertEq(id, 1);
        assertEq(market.nextOrderId(), 2);
        (uint256 b, address maker, bool isSell, uint128 amount, uint128 price, uint64 exp) = market.orders(id);
        assertEq(b, bondId);
        assertEq(maker, issuer);
        assertTrue(isSell);
        assertEq(amount, 20);
        assertEq(price, PX);
        assertEq(exp, expiry);
        assertEq(_buy(inv1, 5, PX), 2); // GTC buy stores expiry 0
        (,,,,, exp) = market.orders(2);
        assertEq(exp, 0);
    }

    function test_place_revertsInactive() public {
        vm.expectRevert(abi.encodeWithSelector(BondMarket.BondNotActive.selector, 99, BondRegistry.Status.None));
        vm.prank(issuer);
        market.place(99, true, 1, PX, 0);

        registry.setStatus(bondId, BondRegistry.Status.Frozen);
        vm.expectRevert(abi.encodeWithSelector(BondMarket.BondNotActive.selector, bondId, BondRegistry.Status.Frozen));
        _sell(1, PX, 0);
    }

    function test_place_revertsBadAmountPriceExpiry() public {
        vm.expectRevert(BondMarket.BadAmount.selector);
        _sell(0, PX, 0);
        vm.expectRevert(BondMarket.BadPrice.selector);
        _sell(1, 0, 0);
        vm.expectRevert(BondMarket.BadExpiry.selector);
        _sell(1, PX, uint64(block.timestamp)); // expiry must be strictly in the future
        vm.expectRevert(BondMarket.BadExpiry.selector);
        _sell(1, PX, uint64(block.timestamp - 1));
        assertEq(_sell(1, PX, uint64(block.timestamp + 1)), 1);
    }

    // ----------------------------------------------------------------- cancel

    function test_cancel_onlyMaker() public {
        uint256 id = _sell(20, PX, 0);
        vm.expectRevert(BondMarket.NotMaker.selector);
        vm.prank(inv1);
        market.cancel(id);
        vm.expectRevert(abi.encodeWithSelector(BondMarket.OrderNotFound.selector, 7));
        vm.prank(issuer);
        market.cancel(7);
    }

    function test_cancel_deletes() public {
        uint256 id = _sell(20, PX, 0);
        vm.expectEmit(address(market));
        emit BondMarket.OrderCancelled(id);
        vm.prank(issuer);
        market.cancel(id);
        (, address maker,, uint128 amount,,) = market.orders(id);
        assertEq(maker, address(0));
        assertEq(amount, 0);
        vm.expectRevert(abi.encodeWithSelector(BondMarket.OrderNotFound.selector, id));
        _fill(inv1, id, 1);
        vm.expectRevert(abi.encodeWithSelector(BondMarket.OrderNotFound.selector, id));
        vm.prank(issuer);
        market.cancel(id);
    }

    // ------------------------------------------------------------------- fill

    function test_fill_sellOrder_settlesBothLegs() public {
        uint256 id = _sell(20, PX, 0);
        uint256 c = 10 * uint256(PX);
        vm.expectEmit(address(market));
        emit BondMarket.Filled(bondId, id, issuer, inv1, 10, PX, c, 0);
        _fill(inv1, id, 10);
        assertEq(token.balanceOf(issuer), 90);
        assertEq(token.balanceOf(inv1), 10);
        assertEq(usdc.balanceOf(inv1), 1e12 - c);
        assertEq(usdc.balanceOf(issuer), 1e12 + c);
        assertEq(usdc.balanceOf(treasury), 0);
        (,,, uint128 left,,) = market.orders(id);
        assertEq(left, 10);
    }

    function test_fill_buyOrder_settlesBothLegs() public {
        uint128 px = 1_010_000;
        uint256 id = _buy(inv1, 10, px);
        uint256 c = 10 * uint256(px);
        vm.expectEmit(address(market));
        emit BondMarket.Filled(bondId, id, inv1, issuer, 10, px, c, 0);
        _fill(issuer, id, 10);
        assertEq(token.balanceOf(issuer), 90);
        assertEq(token.balanceOf(inv1), 10);
        assertEq(usdc.balanceOf(inv1), 1e12 - c);
        assertEq(usdc.balanceOf(issuer), 1e12 + c);
        (, address maker,,,,) = market.orders(id);
        assertEq(maker, address(0)); // fully filled -> deleted
    }

    function test_fill_partial_keepsRemainder() public {
        uint256 id = _sell(20, PX, 0);
        _fill(inv1, id, 7);
        (, address maker,, uint128 left,,) = market.orders(id);
        assertEq(maker, issuer);
        assertEq(left, 13);
        _fill(inv2, id, 13);
        (, maker,, left,,) = market.orders(id);
        assertEq(maker, address(0));
        assertEq(left, 0);
        assertEq(token.balanceOf(inv1), 7);
        assertEq(token.balanceOf(inv2), 13);
        assertEq(token.balanceOf(issuer), 80);
    }

    function test_fill_revertsExpired() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        uint256 id = _sell(20, PX, expiry);
        vm.warp(expiry); // expiry second itself is already expired
        vm.expectRevert(abi.encodeWithSelector(BondMarket.OrderExpired.selector, id));
        _fill(inv1, id, 1);
    }

    function test_fill_revertsOverfill() public {
        uint256 id = _sell(20, PX, 0);
        vm.expectRevert(BondMarket.BadAmount.selector);
        _fill(inv1, id, 21);
        vm.expectRevert(BondMarket.BadAmount.selector);
        _fill(inv1, id, 0);
        _fill(inv1, id, 20);
    }

    function test_fill_revertsZeroCost_BadAmount() public {
        // 18-decimal bond: 1 unit at price 1 floors to cost 0
        MockATSBond dust = new MockATSBond("X", "X", 18, block.timestamp + 365 days);
        dust.grantKyc(issuer, "vc:demo", 0, 0, issuer);
        dust.grantKyc(inv1, "vc:demo", 0, 0, issuer);
        dust.mint(issuer, 1);
        vm.prank(issuer);
        dust.approve(address(market), 1);
        uint64 maturity = uint64(dust.getMaturityDate());
        vm.prank(issuer);
        uint256 bond2 = registry.register(
            address(dust), address(usdc), 1e6, 500, 30 days, uint64(block.timestamp + 1 days), maturity
        );
        vm.prank(issuer);
        uint256 id = market.place(bond2, true, 1, 1, 0);
        vm.expectRevert(BondMarket.BadAmount.selector);
        _fill(inv1, id, 1);
    }

    function test_fill_revertsWhenBondTransferReturnsFalse() public {
        uint256 id = _sell(20, PX, 0);
        vm.mockCall(
            address(token),
            abi.encodeWithSelector(IATSBond.transferFrom.selector, issuer, inv1, uint256(1)),
            abi.encode(false)
        );
        vm.expectRevert(BondMarket.BondTransferFailed.selector);
        _fill(inv1, id, 1);
        vm.clearMockedCalls();
        _fill(inv1, id, 1);
        assertEq(token.balanceOf(inv1), 1);
    }

    function test_fill_revertsWhenFrozen_BondNotActive() public {
        uint256 id = _sell(20, PX, 0);
        registry.setStatus(bondId, BondRegistry.Status.Frozen);
        vm.expectRevert(abi.encodeWithSelector(BondMarket.BondNotActive.selector, bondId, BondRegistry.Status.Frozen));
        _fill(inv1, id, 1);
        registry.setStatus(bondId, BondRegistry.Status.Active);
        _fill(inv1, id, 1);
    }

    function test_fill_revertsNonKycBuyer_0x10_InvalidKycStatus() public {
        uint256 id = _sell(20, PX, 0);
        vm.expectRevert(_rejected(0x10, MockATSBond.InvalidKycStatus.selector));
        _fill(inv3, id, 1);
    }

    function test_fill_revertsFrozenSeller() public {
        uint256 id = _sell(20, PX, 0);
        token.setAddressFrozen(issuer, true);
        vm.expectRevert(_rejected(0x10, MockATSBond.AccountIsBlocked.selector));
        _fill(inv1, id, 1);
    }

    function test_fill_revertsPaused_0x42() public {
        uint256 id = _sell(20, PX, 0);
        token.pause();
        vm.expectRevert(_rejected(0x42, MockATSBond.IsPaused.selector));
        _fill(inv1, id, 1);
    }

    function test_fill_revertsNoAllowance_0x54() public {
        uint256 id = _sell(20, PX, 0);
        vm.prank(issuer);
        token.approve(address(market), 0);
        vm.expectRevert(_rejected(0x54, MockATSBond.InsufficientAllowance.selector));
        _fill(inv1, id, 1);
        // balance shortfall is the other 0x54: a buy order the seller cannot cover
        uint256 bid = _buy(inv1, 5, PX);
        vm.expectRevert(_rejected(0x54, MockATSBond.InsufficientBalance.selector));
        _fill(inv2, bid, 5);
    }

    function test_fill_bandDisabledByDefault() public {
        assertEq(market.bandBps(bondId), 0);
        uint256 id = _sell(1, 10_000_000, 0); // 10x mark
        _fill(inv1, id, 1);
        assertEq(token.balanceOf(inv1), 1);
    }

    function test_fill_revertsOutOfBand() public {
        vm.expectEmit(address(market));
        emit BondMarket.BandSet(bondId, 100);
        vm.prank(admin);
        market.setBand(bondId, 100); // 1%
        uint256 mark = oracle.mark(bondId);
        uint128 px = uint128(mark * 102 / 100);
        uint256 id = _sell(1, px, 0);
        vm.expectRevert(abi.encodeWithSelector(BondMarket.PriceOutOfBand.selector, px, mark, 100));
        _fill(inv1, id, 1);
        px = uint128(mark * 98 / 100);
        id = _sell(1, px, 0);
        vm.expectRevert(abi.encodeWithSelector(BondMarket.PriceOutOfBand.selector, px, mark, 100));
        _fill(inv1, id, 1);
    }

    function test_fill_withinBand() public {
        vm.prank(admin);
        market.setBand(bondId, 100);
        uint256 mark = oracle.mark(bondId);
        uint256 id = _sell(1, uint128(mark + mark / 100), 0); // exactly +1%
        _fill(inv1, id, 1);
        id = _sell(1, uint128(mark - mark / 100), 0); // exactly -1%
        _fill(inv1, id, 1);
        assertEq(token.balanceOf(inv1), 2);
    }

    function test_fill_feeToTreasury() public {
        vm.expectEmit(address(market));
        emit BondMarket.FeeSet(treasury, 50);
        vm.prank(admin);
        market.setFee(treasury, 50); // 0.5%, paid by the buyer on top
        uint256 id = _sell(10, 1_000_000, 0);
        uint256 c = 10_000_000;
        uint256 fee = 50_000;
        vm.expectEmit(address(market));
        emit BondMarket.Filled(bondId, id, issuer, inv1, 10, 1_000_000, c, fee);
        _fill(inv1, id, 10);
        assertEq(usdc.balanceOf(inv1), 1e12 - c - fee);
        assertEq(usdc.balanceOf(issuer), 1e12 + c);
        assertEq(usdc.balanceOf(treasury), fee);
    }

    function test_setFee_revertsTooHigh() public {
        vm.expectRevert(BondMarket.FeeTooHigh.selector);
        vm.prank(admin);
        market.setFee(treasury, 101);
        vm.expectRevert(BondMarket.FeeTooHigh.selector);
        new BondMarket(registry, oracle, treasury, 101);
        vm.expectRevert(BondMarket.FeeTooHigh.selector);
        vm.prank(admin);
        market.setFee(address(0), 1); // nonzero fee needs a treasury
        vm.prank(admin);
        market.setFee(address(0), 0); // zero fee never transfers, so no treasury is fine
        vm.expectRevert(RegistryAuth.NotAdmin.selector);
        vm.prank(issuer);
        market.setFee(treasury, 10);
        vm.expectRevert(RegistryAuth.NotAdmin.selector);
        vm.prank(issuer);
        market.setBand(bondId, 10);
        vm.prank(admin);
        market.setFee(treasury, 100);
        assertEq(market.feeBps(), 100);
    }

    // ------------------------------------------------------------------ quote

    function test_quote_bestBidAsk_ignoresExpiredAndOtherBonds() public {
        (uint128 bid, uint128 ask) = market.quote(bondId);
        assertEq(bid, 0);
        assertEq(ask, 0);

        uint64 maturity = uint64(token.getMaturityDate()); // read before the prank: arg-list calls consume it
        vm.prank(issuer);
        uint256 bond2 = registry.register(
            address(token), address(usdc), 1e6, 500, 30 days, uint64(block.timestamp + 1 days), maturity
        );
        uint64 soon = uint64(block.timestamp + 1 hours);
        _sell(1, 1_020_000, 0);
        uint256 lowAsk = _sell(1, 1_010_000, 0);
        _sell(1, 500_000, soon); // expires
        _buy(inv1, 1, 980_000);
        _buy(inv2, 1, 990_000);
        vm.prank(inv1);
        market.place(bondId, false, 1, 2_000_000, soon); // expires
        vm.prank(issuer);
        market.place(bond2, true, 1, 100_000, 0);
        vm.prank(inv1);
        market.place(bond2, false, 1, 5_000_000, 0);

        (bid, ask) = market.quote(bondId);
        assertEq(bid, 2_000_000);
        assertEq(ask, 500_000);
        vm.warp(soon);
        (bid, ask) = market.quote(bondId);
        assertEq(bid, 990_000);
        assertEq(ask, 1_010_000);
        (bid, ask) = market.quote(bond2);
        assertEq(bid, 5_000_000);
        assertEq(ask, 100_000);

        vm.prank(issuer);
        market.cancel(lowAsk);
        (, ask) = market.quote(bondId);
        assertEq(ask, 1_020_000);
    }

    // ------------------------------------------------------------------- fuzz

    function testFuzz_fill_settlementConservation(uint128 amount, uint128 price, uint16 fee, uint128 take) public {
        amount = uint128(bound(amount, 1, 100));
        take = uint128(bound(take, 1, amount));
        price = uint128(bound(price, 1, 1e9));
        fee = uint16(bound(fee, 0, 100));
        vm.prank(admin);
        market.setFee(treasury, fee);

        uint256 usdcBefore = usdc.balanceOf(issuer) + usdc.balanceOf(inv1) + usdc.balanceOf(treasury);
        uint256 id = _sell(amount, price, 0);
        _fill(inv1, id, take);

        uint256 c = uint256(take) * price;
        uint256 f = c * fee / 10_000;
        assertEq(usdc.balanceOf(issuer), 1e12 + c);
        assertEq(usdc.balanceOf(inv1), 1e12 - c - f);
        assertEq(usdc.balanceOf(treasury), f);
        assertEq(usdc.balanceOf(issuer) + usdc.balanceOf(inv1) + usdc.balanceOf(treasury), usdcBefore);
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(token.balanceOf(issuer) + token.balanceOf(inv1), 100);
        assertEq(token.balanceOf(inv1), take);
        assertEq(token.balanceOf(address(market)), 0);
        (,,, uint128 left,,) = market.orders(id);
        assertEq(left, amount - take);
    }

    function testFuzz_cost_rounding(uint128 amount, uint128 price, uint8 dec) public view {
        dec = uint8(bound(dec, 0, 18));
        uint256 c = market.cost(amount, price, dec);
        uint256 scale = 10 ** uint256(dec);
        uint256 exact = uint256(amount) * uint256(price);
        assertEq(c, exact / scale);
        assertLe(c * scale, exact); // floored, never overcharges
        assertGt((c + 1) * scale, exact); // within one unit
    }
}
