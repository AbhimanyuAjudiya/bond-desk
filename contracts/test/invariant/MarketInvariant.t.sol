// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {BondDeskTest} from "../Base.t.sol";
import {BondMarket} from "../../src/BondMarket.sol";
import {MockATSBond} from "../../src/mocks/MockATSBond.sol";

/// @dev Bounded random actions over a 4-actor set; reverts are swallowed so every call advances state.
contract MarketHandler is CommonBase, StdUtils {
    BondMarket internal market;
    MockATSBond internal token;
    uint256 internal bondId;
    address[] public actors;
    uint256[] public orderIds;
    uint256 public fills; // successful fills, so a run that only ever reverts is visible

    constructor(BondMarket market_, MockATSBond token_, uint256 bondId_, address[] memory actors_) {
        market = market_;
        token = token_;
        bondId = bondId_;
        actors = actors_;
    }

    function orderCount() external view returns (uint256) {
        return orderIds.length;
    }

    function place(uint256 a, bool isSell, uint128 amount, uint128 price, uint64 ttl) external {
        amount = uint128(bound(amount, 1, 50));
        price = uint128(bound(price, 1, 2_000_000));
        uint64 expiry = ttl % 2 == 0 ? 0 : uint64(block.timestamp + bound(ttl, 1, 2 days));
        vm.prank(_actor(a));
        try market.place(bondId, isSell, amount, price, expiry) returns (uint256 id) {
            orderIds.push(id);
        } catch {}
    }

    function cancel(uint256 a, uint256 o) external {
        if (orderIds.length == 0) return;
        vm.prank(_actor(a));
        try market.cancel(orderIds[bound(o, 0, orderIds.length - 1)]) {} catch {}
    }

    function fill(uint256 a, uint256 o, uint128 amount) external {
        if (orderIds.length == 0) return;
        uint256 id = orderIds[bound(o, 0, orderIds.length - 1)];
        (,,, uint128 open,,) = market.orders(id);
        amount = uint128(bound(amount, 1, open == 0 ? 1 : open)); // an over-fill of a dead order still exercises the revert
        vm.prank(_actor(a));
        try market.fill(id, amount) {
            ++fills;
        } catch {}
    }

    function warp(uint256 s) external {
        vm.warp(block.timestamp + bound(s, 0, 1 days));
    }

    function toggleKyc(uint256 a) external {
        address who = _actor(a);
        if (token.kyc(who)) token.revokeKyc(who);
        else token.grantKyc(who, "vc:fuzz", block.timestamp - 1, block.timestamp + 1, address(0));
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }
}

contract MarketInvariantTest is BondDeskTest {
    uint256 internal constant USDC_POOL = 4 * 1e12; // four actors funded by the fixture

    BondMarket internal market;
    MarketHandler internal handler;
    address internal treasury = makeAddr("treasury");
    address[] internal actors;

    function _deployExtensions() internal override {
        market = new BondMarket(registry, oracle, treasury, 25);
        actors = [issuer, inv1, inv2, inv3];
        for (uint256 i; i < actors.length; ++i) {
            vm.startPrank(actors[i]);
            token.approve(address(market), type(uint256).max);
            usdc.approve(address(market), type(uint256).max);
            vm.stopPrank();
        }
        handler = new MarketHandler(market, token, bondId, actors);
        targetContract(address(handler));
    }

    function invariant_settlementConserved() public view {
        uint256 sum = usdc.balanceOf(treasury) + usdc.balanceOf(address(market));
        for (uint256 i; i < actors.length; ++i) {
            sum += usdc.balanceOf(actors[i]);
        }
        assertEq(sum, USDC_POOL);
    }

    function invariant_bondSupplyConserved() public view {
        assertEq(token.totalSupply(), 100);
        uint256 sum = token.balanceOf(address(market));
        for (uint256 i; i < actors.length; ++i) {
            sum += token.balanceOf(actors[i]);
        }
        assertEq(sum, 100);
    }

    function invariant_noNegativeOrOverdrawnBalances() public view {
        for (uint256 i; i < actors.length; ++i) {
            assertLe(token.balanceOf(actors[i]), 100);
            assertLe(usdc.balanceOf(actors[i]), USDC_POOL);
        }
        assertEq(token.balanceOf(address(market)), 0); // market is an operator, never a holder
        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(token.balanceOf(treasury), 0);
    }

    function invariant_liveOrdersHaveMakerAndAmount() public view {
        uint256 end = market.nextOrderId();
        for (uint256 id = 1; id < end; ++id) {
            (uint256 b, address maker,, uint128 amount, uint128 price,) = market.orders(id);
            if (maker == address(0)) {
                assertEq(amount, 0);
                assertEq(price, 0);
            } else {
                assertEq(b, bondId);
                assertGt(amount, 0);
                assertGt(price, 0);
            }
        }
    }
}
