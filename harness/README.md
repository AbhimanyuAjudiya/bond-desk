# Hedera Foundry Harness

[hedera-dev/hedera-harness](https://github.com/hedera-dev/hedera-harness) orchestrates agents through validation tiers with one rule: *validation is authoritative* — work is not done until an independent check says so. This directory is the Foundry/Solidity counterpart, built around the two things that make Hedera different from a plain EVM chain:

1. The system contracts live at fixed addresses (Schedule Service `0x16b`, Token Service `0x167`), return response codes instead of reverting, and are invisible to forks (`eth_getCode(0x16b)` is `0x` through the relay).
2. A scheduled call (HIP-1215) only proves itself later, on the mirror node.

So the harness gives you: mocks that sit at the real addresses and speak the real codes, a base test that drives scheduled executions, a library that hides the capacity-probing dance, and three scripts that check the machine, verify the source, and read the mirror node.

```
harness/
  src/HederaHarness.sol        library: constants, schedule, findAvailableSecond, scheduleWithProbe, associate, htsTransfer, ok
  src/HederaTest.sol           abstract contract HederaTest is Test: installHedera, warpAndExecute, executeDueSchedules, executeLagged, hbar
  src/interfaces/              ABI-exact subsets of IHRC1215 and IHederaTokenService (hiero-contracts 0.2.0)
  src/mocks/MockHSS.sol        0x16b: busy seconds, no capacity, nested-recursion 373, executeDue/execute, Executed event
  src/mocks/MockHTS.sol        0x167: association (194/184) and recorded transfers
  script/DeployTemplate.s.sol  deploy + fund + schedule one call, prints the verify/validate commands
  scripts/doctor.sh            Tier 1   verify.sh   validate-schedule.sh   Tier 3.5   loc.sh
  examples/                    the same contract with and without the harness (numbers below)
  test/                        HederaHarness.t.sol, Examples.t.sol
```

## Quickstart

Dependency: forge-std only. Remapping (already in `remappings.txt`): `hedera-harness/=harness/src/`.

```solidity
import {HederaHarness} from "hedera-harness/HederaHarness.sol";

contract Coupon {
    error ScheduleFailed(int64 rc);

    receive() external payable {} // the scheduling contract pays for the future call: keep HBAR here

    function pay() external { /* ... */ }

    function scheduleNext(uint256 when) external returns (address sched, uint256 at) {
        int64 rc;
        (sched, rc, at) = HederaHarness.scheduleWithProbe(
            address(this), when, 2_000_000, abi.encodeCall(this.pay, ()), 8
        );
        require(HederaHarness.ok(rc), ScheduleFailed(rc));
    }
}
```

```solidity
import {HederaTest} from "hedera-harness/HederaTest.sol";

contract CouponTest is HederaTest {
    function test_couponFires() public {
        Coupon c = new Coupon();
        vm.deal(address(c), hbar(5));                  // tinybar, as the Hedera EVM sees msg.value
        uint256 when = block.timestamp + 60;
        hss.setBusy(when, true);                       // simulate a full throttle bucket
        (, uint256 at) = c.scheduleNext(when);         // slides to when + 1
        warpAndExecute(at);                            // the network fires it
    }
}
```

```bash
FOUNDRY_PROFILE=harness forge test -vv                                     # Tier 0
harness/scripts/doctor.sh                                                  # Tier 1
forge script harness/script/DeployTemplate.s.sol:DeployTemplate \
  --rpc-url hedera --broadcast --slow --skip-simulation -vvvv              # Tier 3 (needs .env, see FAUCET.md)
harness/scripts/verify.sh <addr> harness/examples/WithHarness.sol:PingWithHarness
harness/scripts/validate-schedule.sh <schedule address> --wait 300         # Tier 3.5
```

`--skip-simulation` is not optional and the template etches `MockHSS` at `0x16b` before broadcasting: forge's own EVM has no code there, so without both the scheduling tx reverts locally and nothing is sent (see *Things that bite*). The schedule address the script prints comes from the receipt, not from the mock.

## API

| Item | Signature | Notes |
|---|---|---|
| `HederaHarness.HSS` / `HTS` | `IHederaScheduleService(0x16b)` / `IHederaTokenService(0x167)` | |
| chain ids | `CHAIN_MAINNET 295`, `CHAIN_TESTNET 296`, `CHAIN_PREVIEWNET 297`, `CHAIN_LOCAL 298` | |
| codes | `SUCCESS 22`, `INVALID_CONTRACT_ID 16`, `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT 194`, `INVALID_SCHEDULE_ID 201`, `SCHEDULE_ALREADY_DELETED 212`, `SCHEDULE_ALREADY_EXECUTED 213`, `SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE 306`, `..._MUST_BE_HIGHER_THAN_CONSENSUS_TIME 307`, `SCHEDULE_EXPIRY_IS_BUSY 370`, `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION 373` | `int64` |
| units | `MAX_SCHEDULE_AHEAD = 62 days`, `TINYBAR = 1e8`, `WEIBAR_PER_TINYBAR = 1e10` | relay: 18-dec wei; EVM: tinybar |
| `ok(rc)` | `(int64) → bool` | `rc == SUCCESS` |
| `schedule(to, when, gas, data)` | `→ (address sched, int64 rc)` | `scheduleCall` with value 0 |
| `hasCapacity(when, gas)` | `→ bool` | |
| `findAvailableSecond(when, gas, maxProbes)` | `view → (uint256 second, bool found)` | HIP-1215 back-off: probe *i* checks `when + 2^i + jitter`, jitter `= uint16(keccak(prevrandao, i)) % 2^i`; never reverts |
| `scheduleWithProbe(to, when, gas, data, maxProbes)` | `→ (address sched, int64 rc, uint256 actualWhen)` | `rc = 370`, `sched = 0` when no probe found capacity |
| `deleteSchedule(sched)` | `→ int64` | |
| `associate(token)` | `→ int64` | for `address(this)`; 194 is mapped to 22 |
| `htsTransfer(token, to, amount)` | `→ int64` | from `address(this)` |
| `HederaTest.installHedera()` | | etches both mocks, sets `hss` / `hts`, labels them; `setUp()` calls it |
| `HederaTest.warpAndExecute(t)` / `executeDueSchedules()` | | `vm.warp` then fire every pending schedule with `when <= now` |
| `HederaTest.executeLagged(sched, lag)` | | fire `sched` at its second inside a block that started `lag` s earlier: `block.timestamp` is the block's start, ~2 s behind the expiry second on testnet |
| `HederaTest.hbar(n)` | `pure → uint256` | `n * 1e8` |
| `MockHSS.setBusy(second, bool)` / `setNoCapacity(bool)` / `setBlockNested(bool)` | | 370 on that second / 370 everywhere / 373 when scheduling from inside an execution |
| `MockHSS.execute(sched)` / `get(sched)` / `count()` | | fire one regardless of time / inspect / `Executed(schedule, success, result)` is emitted per firing |
| `MockHSS.idOf(sched)` / `addressOf(index)` | `→ uint256` / `pure → address` | `idOf` is index + 1 (0 = unknown); `addressOf(i) = 0x5c4ed000 + i`, so the first schedule is `0x5c4ed000` and `addressOf(idOf(s) - 1) == s` |
| `MockHTS.associated(account, token)` / `transfers(i)` / `transferCount()` | | recipient must be associated or transfers return 184 |

Mock semantics that match the network: expiry must be in `(now, now + 62 days]` (307 / 306), `to == 0` is 16, a schedule fires once even if the call reverts (`Executed(..., false, ...)`), `deleteSchedule` returns 201 / 212 / 213 / 22.

Where `MockHSS` is more lenient than the real HSS, so a passing Tier 0 test is not proof on its own: `deleteSchedule` does not check that the caller created the schedule; execution does not debit a payer balance, so an underfunded payer never shows up; and `hasScheduleCapacity` ignores its gas argument entirely — it is gas-blind beyond the `noCapacity` flag and the `busy` map. Gas budgets and payer funding are Tier 3 / 3.5 findings.

## Before / after

`harness/scripts/loc.sh` (non-blank, non-comment lines):

| Per project | Without harness | With harness |
|---|---:|---:|
| Contract: interface, probe, response codes (`examples/WithoutHarness.sol` vs `examples/WithHarness.sol`) | 64 | 21 |
| Deploy, fund, schedule, verify, validate (`examples/without/deploy-verify-check.sh` vs `script/DeployTemplate.s.sol`; verify/validate become one-line calls to `scripts/`) | 34 | 31 |
| **Total** | **98** | **52** |

Shared once (`src/HederaHarness.sol`, `src/HederaTest.sol`, interfaces): 128 lines.

The part that does not show in line counts: without the harness there is no way to unit-test the schedule at all — `0x16b` has no code in Foundry or in a fork — so the first time the probe loop runs is on testnet.

## Tiers

| Tier | Command | Proves | Exit |
|---|---|---|---|
| 0 | `FOUNDRY_PROFILE=harness forge test` | logic against the mocks: codes, window, probing, firing, nested 373, the block-timestamp lag, HTS association | forge |
| 1 | `harness/scripts/doctor.sh` | forge ≥ 1.0 and PATH order, solc 0.8.28, RPC `eth_chainId == 0x128`, key with ≥ 20 HBAR, Sourcify lists 296, mirror node reachable | number of failed checks |
| 3 | `DeployTemplate.s.sol` (`--skip-simulation`) + `verify.sh` | deployed, funded, scheduled, source verified (Sourcify, then HashScan's verifier; `verify.sh` selects `FOUNDRY_PROFILE=harness` for `harness/` targets) | |
| 3.5 | `validate-schedule.sh <addr> [--wait s]` | mirror node `GET /schedules/0.0.N` has `executed_timestamp != null` | 0 iff executed |

Tier 3.5 is the authoritative one. A `SUCCESS` from `scheduleCall` means the schedule was *created*; only the mirror node says it *ran*. There is no fork tier on purpose: forks see no system contracts, so fork tests etch the same mocks.

### Stages, against hedera-dev/hedera-harness

| hedera-harness stage | Here | What it proves |
|---|---|---|
| ASSERT | Tier 0 (`forge test`) and Tier 1 (`doctor.sh`) | deterministic checks with no chain: mocks at the real addresses, response codes, the probe loop, the block-timestamp lag; then the machine, the RPC and the key |
| SMOKE | Tier 3 (`DeployTemplate.s.sol` + `verify.sh`) | one real deploy, fund and schedule, plus a Sourcify exact match |
| CHAIN | Tier 3.5 (`validate-schedule.sh`) | the network did it: `executed_timestamp` on the mirror node |
| GENERATE, repair | none, by design | Foundry tests are deterministic and the mocks are exact on codes and window, so a failing tier is a bug to fix in the contract, not a reason to regenerate; the repair loop is `forge test` |

## Things that bite

- `msg.value` and balances are tinybar inside the EVM (`5 ether` sent through the relay arrives as `5e8`).
- The contract that calls `scheduleCall` is the payer of the future execution. Fund it, keep a float, add `receive()`.
- `hasScheduleCapacity` is a throttle check, not a reservation; `scheduleWithProbe` can still get 370 on a busy network — handle `rc != 22` instead of assuming.
- Scheduling from inside a scheduled call can return 373; keep a permissionless re-schedule entry point.
- Nothing beyond 62 days can be scheduled; long intervals need a re-schedule inside the window.
- HSS fires a schedule at its expiry second, but `block.timestamp` inside the run is the start of the block it lands in, up to ~2 s earlier. The desk's coupon 2 was scheduled at exactly `nextCoupon = 1789121682`, ran in block `40378969` (window starts `1789121680.007`) and reverted `CouponNotDue`; the ping in *Receipts* asked for `1789155023` and logged `Pinged(1789155022)`. Schedule anything gated on `block.timestamp >= due` at `due + lag` (`BondLifecycle.SCHEDULE_LAG = 10`); `HederaTest.executeLagged(sched, 2)` reproduces the gap in Tier 0.
- `forge script` runs the script, and (without `--skip-simulation`) replays the collected txs, in an EVM where `0x16b` has no code, so a scheduling call reverts before anything is broadcast. Do what `DeployTemplate.s.sol` does: `vm.etch(address(HederaHarness.HSS), type(MockHSS).runtimeCode)` before `vm.startBroadcast` (cheatcode state never reaches the chain) and pass `--skip-simulation` so gas comes from the relay's `eth_estimateGas`, which does resolve `0x16b`. Whatever the script gets back (schedule address, actual second) is the mock's answer; the real values are in the receipt's `Scheduled` event in `broadcast/<Script>/<chainId>/run-latest.json` — the template prints the one-liner that decodes it.

## Receipts

Tier 3 and 3.5 run on 2026-09-11 against Hedera testnet with the deployer key. Broadcast record:
`broadcast/DeployTemplate.s.sol/296/run-latest.json`.

```
$ forge script harness/script/DeployTemplate.s.sol:DeployTemplate --rpc-url hedera --broadcast --slow --skip-simulation -vvvv
  ├─ [168124] PingWithHarness::schedulePing(1789155023 [1.789e9])
  │   ├─ [159988] 0x000000000000000000000000000000000000016B::scheduleCall(PingWithHarness: [0x0F14C057F7912651254f9A4c61778033CB054FBE], 1789155023 [1.789e9], 2000000 [2e6], 0, 0x5c36b186)
  │   ├─ emit Scheduled(schedule: 0x000000000000000000000000000000005C4Ed000, when: 1789155023 [1.789e9])   <- the mock's answer, local run only
  PingWithHarness:   0x0F14C057F7912651254f9A4c61778033CB054FBE
  requested second:  1789155023
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.

$ jq -r '.receipts[-1].logs[] | select(.topics[0]=="0x6ba9eacd…c8231") | .data' broadcast/DeployTemplate.s.sol/296/run-latest.json | xargs cast abi-decode 'f()(address,uint256)'
0x00000000000000000000000000000000009Ff515
1789155023

$ harness/scripts/verify.sh 0x0F14C057F7912651254f9A4c61778033CB054FBE harness/examples/WithHarness.sol:PingWithHarness
== harness/examples/WithHarness.sol:PingWithHarness @ 0x0F14C057F7912651254f9A4c61778033CB054FBE via https://sourcify.dev/server
verified: https://hashscan.io/testnet/contract/0x0F14C057F7912651254f9A4c61778033CB054FBE

$ harness/scripts/validate-schedule.sh 0x00000000000000000000000000000000009Ff515 --wait 300
0.0.10482965: pending; retrying in 10s
0.0.10482965: pending; retrying in 10s
executed at 1789155023.095848659  https://hashscan.io/testnet/schedule/0.0.10482965
```

| Item | Receipt |
|---|---|
| `PingWithHarness` (0.0.10482957) | [`0x0F14C057F7912651254f9A4c61778033CB054FBE`](https://hashscan.io/testnet/contract/0x0F14C057F7912651254f9A4c61778033CB054FBE), Sourcify `exact_match` at `2026-09-11T19:30:47Z` |
| create, 371,091 gas | [`0xd7a000a4…8f1018`](https://hashscan.io/testnet/transaction/0xd7a000a4baf9c6bc0a3bf0bb036729850f0977b524a4a24127196946ed8f1018) |
| 5 HBAR float (the contract is the HSS payer) | [`0x11a0c089…528e0f`](https://hashscan.io/testnet/transaction/0x11a0c0891679ace3c82655f67e152c659f985dc6cacc807e56b02ed7de528e0f) |
| `schedulePing(1789155023)`, 1,439,265 gas | [`0x9faecd60…1096fa`](https://hashscan.io/testnet/transaction/0x9faecd60628a93cf03f35c725c6e394d98b09ad8584d22d80c81a3815c1096fa) |
| schedule `0.0.10482965` | `expiration_time 1789155023.000000000`, `executed_timestamp 1789155023.095848659`, `payer_account_id 0.0.10482957`, child `CONTRACTCALL SUCCESS scheduled: true`, fee 5,066,958 tinybar; `pings()` reads 1 |

The `Pinged` log the execution emitted carries `block.timestamp = 1789155022`: the run landed in block `40394623`,
whose window starts at `1789155022.915953220`, one second before the expiry second it was asked for. `ping()` has
no time gate so it did not care; a coupon would have. That is the lag bullet in *Things that bite*.
