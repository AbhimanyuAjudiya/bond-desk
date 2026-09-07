// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";
import {BondRegistry} from "../../src/BondRegistry.sol";
import {NavOracle} from "../../src/NavOracle.sol";

/// @notice Live Chainlink HBAR/USD feed on Hedera testnet, read through NavOracle.
/// @dev `FORK=1 FOUNDRY_PROFILE=fork forge test --fork-url https://testnet.hashio.io/api -vv`; skipped otherwise.
contract FeedForkTest is Test {
    AggregatorV3Interface internal constant FEED = AggregatorV3Interface(0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a);

    modifier fork() {
        if (!vm.envOr("FORK", false)) {
            vm.skip(true);
            return;
        }
        _;
    }

    function test_fork_feedDecimals8() public fork {
        assertEq(FEED.decimals(), 8);
    }

    /// @dev Heartbeat is 24h; anything under 48h proves the feed is alive on testnet.
    function test_fork_latestRoundData_positiveAndFresh() public fork {
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = FEED.latestRoundData();
        console2.log("HBAR/USD round %s answer %s updatedAt %s", roundId, uint256(answer), updatedAt);
        assertGt(answer, 0);
        assertLe(block.timestamp - updatedAt, 48 hours);
    }

    function test_fork_navOracle_hbarUsd() public fork {
        BondRegistry registry = new BondRegistry(address(this));
        NavOracle oracle = new NavOracle(registry, FEED, 48 hours);
        (, int256 answer,,,) = FEED.latestRoundData();
        assertEq(oracle.hbarUsd(), uint256(answer));
        console2.log("NavOracle.hbarUsd() = %s (8 dec)", oracle.hbarUsd());
    }
}
