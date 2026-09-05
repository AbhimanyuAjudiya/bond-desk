// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {HederaHarness} from "../src/HederaHarness.sol";
import {MockHSS} from "../src/mocks/MockHSS.sol";
import {PingWithHarness} from "../examples/WithHarness.sol";

/// @notice Tier 3 template: deploy a self-scheduling contract, fund it (it is the HSS payer),
///         schedule one call, and print the Tier 1/3.5 commands that prove it.
/// @dev `forge script harness/script/DeployTemplate.s.sol:DeployTemplate --rpc-url hedera --broadcast --slow --skip-simulation -vvvv`
///      `--skip-simulation` is required. Forge runs the script locally and, unless skipped, replays the collected
///      txs on a fresh fork; in both EVMs 0x16b has no code (the relay answers `eth_getCode` with `0x`), so any
///      scheduling call reverts before a single tx is broadcast. The mock is etched for the local run and the replay
///      is skipped; gas then comes from the relay's `eth_estimateGas`, which does resolve 0x16b.
contract DeployTemplate is Script {
    error FundFailed();

    function run() external {
        uint256 pk = vm.envUint("HEDERA_PRIVATE_KEY");
        uint256 when = block.timestamp + vm.envOr("PING_DELAY", uint256(120));

        // Local run only: cheatcode state never reaches the chain.
        vm.etch(address(HederaHarness.HSS), type(MockHSS).runtimeCode);

        vm.startBroadcast(pk);
        PingWithHarness ping = new PingWithHarness();
        // 5 HBAR: the relay takes 18-decimal wei, the contract sees tinybar.
        (bool sent,) = address(ping).call{value: 5 ether}("");
        if (!sent) revert FundFailed();
        // Return values here come from the mock; the real schedule address is in the on-chain receipt (below).
        ping.schedulePing(when);
        vm.stopBroadcast();

        console.log("PingWithHarness:  ", address(ping));
        console.log("requested second: ", when);
        console.log(
            "verify:   harness/scripts/verify.sh %s harness/examples/WithHarness.sol:PingWithHarness", address(ping)
        );
        console.log("schedule: decode the Scheduled(address,uint256) event from the broadcast receipt:");
        console.log(
            "  jq -r '.receipts[-1].logs[] | select(.topics[0]==\"%s\") | .data' broadcast/DeployTemplate.s.sol/%s/run-latest.json | xargs cast abi-decode 'f()(address,uint256)'",
            vm.toString(PingWithHarness.Scheduled.selector),
            vm.toString(block.chainid)
        );
        console.log("validate: harness/scripts/validate-schedule.sh <schedule address> --wait 300");
    }
}
