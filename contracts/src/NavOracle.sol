// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondRegistry} from "./BondRegistry.sol";
import {RegistryAuth} from "./RegistryAuth.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @notice HBAR/USD price (Chainlink, 8 decimals, staleness-guarded) and the accrued-interest mark of a bond.
contract NavOracle is RegistryAuth {
    AggregatorV3Interface public immutable feed;
    uint256 public staleAfter;
    uint256 public constant YEAR = 365 days;

    event StaleAfterSet(uint256 staleAfter);

    error BadFeedDecimals(uint8 got);
    error BadAnswer(int256 answer);
    error StaleFeed(uint256 updatedAt, uint256 staleAfter);

    constructor(BondRegistry registry_, AggregatorV3Interface feed_, uint256 staleAfter_) RegistryAuth(registry_) {
        uint8 d = feed_.decimals();
        if (d != 8) revert BadFeedDecimals(d);
        feed = feed_;
        staleAfter = staleAfter_;
    }

    /// @notice Latest HBAR/USD answer (8 decimals); reverts on non-positive or stale answers.
    function hbarUsd() public view returns (uint256 price8) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert BadAnswer(answer);
        if (block.timestamp > updatedAt + staleAfter) revert StaleFeed(updatedAt, staleAfter);
        return uint256(answer);
    }

    /// @notice Clean price + linear coupon accrual since the current period started, in settlement units per whole bond.
    ///         Face value after maturity. Never touches the feed.
    function mark(uint256 bondId) external view returns (uint256) {
        BondRegistry.BondTerms memory t = registry.terms(bondId);
        if (block.timestamp >= t.maturity) return t.faceValue;
        uint256 periodStart = t.nextCoupon > t.couponInterval ? t.nextCoupon - t.couponInterval : 0;
        uint256 elapsed = block.timestamp > periodStart ? block.timestamp - periodStart : 0;
        if (elapsed > t.couponInterval) elapsed = t.couponInterval;
        return t.faceValue + t.faceValue * t.couponRateBps * elapsed / (10_000 * YEAR);
    }

    function setStaleAfter(uint256 staleAfter_) external onlyAdmin {
        staleAfter = staleAfter_;
        emit StaleAfterSet(staleAfter_);
    }
}
