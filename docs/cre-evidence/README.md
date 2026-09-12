# CRE evidence

Simulator output from the two confidential workflows, plus the Sepolia challenge record. A production TEE run
produces no logs anyone can read, by design, so the simulator is the only place the behaviour is observable.

Nothing here is written by hand. Every `.log` file is `tee`'d straight from the command in the table below,
unedited, including the simulator's own banner stating that it is not a real TEE. `challenge.md` is the one
hand-written file and every hash in it is pasted from a script's output.

## Index

| File | Command | What it proves |
|---|---|---|
| `bond-monitor-20260910-1527-warn.log` | `bun run sim:bond` | The confidential path runs end to end: the `Handler requested TEE Execution` banner, `[USER LOG]` lines, one batched `getSecrets`, one HTTP call (`eth_call RiskGate.snapshot(1)`), a decision, an in-enclave EIP-712 signature, and `VERDICT_JSON`. Verdict: `action=1` (WARN), `reason=below-warn`, `coverageObserved: 762`, `nonce: 1`. |
| `bond-monitor-20260910-1533-freeze.log` | `bun run sim:bond`, after 20 HBAR left the vault | Same config (`Config hash 91df4789…` is identical in both runs), lower coverage, different verdict: `action=2` (FREEZE), `reason=below-freeze`, `coverageObserved: 610`, `nonce: 2`. Nonce 1 to 2 is the replay guard: the nonce comes from the same snapshot the decision used, so neither verdict can be resubmitted. |
| `liquidation-protection-20260910-1424-nodebt.log` | `bun run sim:liq`, before `join()` | TEE banner, an empty position read from Sepolia (`hfChain` is `uint256` max, mapped to the sentinel `hf=1000000000`), `plan=no-debt`, result `SAFE`. No transaction is signed when there is nothing to defend. |
| `liquidation-protection-20260910-1426-defend-reverted.log` | `bun run sim:liq`, right after `join()` | `hf=111` sits at or below the private trigger, so the enclave signed and broadcast `repay(100000)` (vUSD has 2 decimals, so 1,000.00 vUSD): [`0xf3e806bc…dc7effe8`](https://sepolia.etherscan.io/tx/0xf3e806bce55bc2ed87bd7bc3d9b7b3bbd604a4b1b4dc6f7514ace408dc7effe8), which **reverted with `Scenario has not started`**. The challenge contract's `onlyActive` gate only opens while Chainlink is running a scoring scenario. |
| `liquidation-protection-20260910-1433-inactive.log` | `bun run sim:liq`, after adding the gate probe | A ninth sub-call in the same JSON-RPC batch simulates `repay(1)` with `eth_call`. The workflow sees the closed gate, logs `plan=scenario-inactive`, returns `INACTIVE`, and spends no gas. During a live scenario the probe succeeds and the defend path runs unchanged. |
| `bond-monitor-20260912-0057-warn.log` | `bun run sim:bond`, final code | Re-run on the submitted code after the policy rotation (below). The banner now names the enclave constraint the handler asks for (`AWS Nitro in us-west-2`); then one batched `getSecrets`, one HTTP call, `action=1` (WARN), `reason=below-warn`, `coverageObserved: 595`, `nonce: 3` (two verdicts already applied on-chain). Signed in the simulator, not relayed. |
| `liquidation-protection-20260912-0057-inactive.log` | `bun run sim:liq`, final code | Same banner, the nine-sub-call batch, `plan=scenario-inactive (gate closed)`, result `INACTIVE`, no transaction: the gate is still closed before the scoring window, and the handler declines instead of paying for a revert. |
| `challenge.md` | `bun run setup:challenge` | The two `approve` hashes and the `join()` hash on Sepolia, the participant wallet, and the position `join()` created. Required for the Chainlink Automated Liquidation Protection Challenge. |

## Policy rotation, 2026-09-12

Both private policies were replaced after the 2026-09-10 runs and before the 2026-09-12 re-run: the five
liquidation values (trigger and target health factors, repay and deposit caps, cooldown) and the bond coverage
ladder (WARN and FREEZE; the DEFAULT floor stays disabled). Reason: the committed `workflow/.env.example` used
to carry the liquidation values verbatim, and the `1426` log's `repay: 100000` against `hf=111` lets a reader
solve for the old target. So nothing in the committed 2026-09-10 logs describes the live policy any more, the
old values are in neither the repository nor `workflow/.env`, `.env.example` now holds placeholders, and
`workflow/README.md` ("Choosing a policy") explains units and constraints without giving numbers. The 09-10
logs stay here unchanged as the record of what happened that day.

## The verdicts that reached Hedera

The two bond-monitor verdicts above were relayed to `RiskGate` at
`0x1dFF1d5458D6a6f6af46014de76474DC3170C31B` on chain 296. The relayer verified each signature locally before
spending gas, then submitted it.

| Verdict | Action | Coverage | Nonce | Relay tx |
|---|---|---|---|---|
| `bond-monitor-20260910-1527-warn.log` | WARN | 762 bps | 1 | [`0xe534d72b…c6e085dd7b6`](https://hashscan.io/testnet/transaction/0xe534d72b2f9ec132756dc66b63e1476b05a50d13f8613b69a327ac6e085dd7b6) |
| `bond-monitor-20260910-1533-freeze.log` | FREEZE | 610 bps | 2 | [`0x18d46f96…573db14e`](https://hashscan.io/testnet/transaction/0x18d46f9627d0e7808d2c78d73848c5aefd813d73147bd19abc74c8e0573db14e) |

After the FREEZE landed, `BondRegistry.status(1)` is `Frozen` and a fill from a KYC'd wallet reverts
`BondNotActive` (selector `0x34823ce5`). The full storyline with every transaction is in the root `README.md`.

## Log line shape

`bond-monitor` prints `bond=<id> status=<name> coverage=<bucket> action=<NAME> reason=<slug> nonce=<n>`, where
the bucket is one of `>=150%` / `120-150%` / `100-120%` / `<100%`. The exact coverage and every threshold stay
inside the enclave. `VERDICT_JSON` carries only fields that are about to be published on-chain anyway: `bondId`,
`action`, `coverageObserved`, `issuedAt`, `nonce`, the signature, the chain id and the `RiskGate` address.

`liquidation-protection` prints `liq hf=<sentinel-or-value> hfChain=<raw> plan=<slug> txs=<sent>/<planned>`, or
`liq plan=scenario-inactive (gate closed|probe failed)`. The private trigger, target, caps and cooldown never
appear, and a malformed policy secret is rejected by `policyInt` with a message that names the secret id, not
its value.

## Reproduce

```sh
cd workflow
cp .env.example .env        # then fill it in; .env is gitignored
bun install
bun test                    # decide ladder, rpc batching, fake-runtime handler test
bun run typecheck

mkdir -p ../docs/cre-evidence
bun run sim:bond 2>&1 | tee ../docs/cre-evidence/bond-monitor-$(date +%Y%m%d-%H%M)-warn.log
bun run sim:liq  2>&1 | tee ../docs/cre-evidence/liquidation-protection-$(date +%Y%m%d-%H%M)-nodebt.log
```

`cre workflow simulate` (what `sim:bond` and `sim:liq` wrap) requires `cre login` in a browser **and** a
`CRE_ETH_PRIVATE_KEY` in `.env` just to boot, even for a simulation that spends nothing. See
`docs/FEEDBACK/chainlink.md`. Without a login the reproduction stops at `bun test && bun run typecheck`, which
still exercises the whole policy module.

Per-file notes:

- **The WARN and FREEZE pair.** The two logs differ because chain state differed, not because a threshold moved.
  To reproduce: run `sim:bond`, then withdraw collateral from the vault, then run it again.

  ```sh
  # 2000000000 = 20 HBAR in tinybar: the vault stores collateral in the units the Hedera EVM sees,
  # and a function argument is not converted by the relay the way `value` is.
  cast send 0x82db4a2ba9859816D60E3d3CE2F6F1E29818FaF7 'withdraw(uint256,uint256)' 1 2000000000 \
    --private-key "$HEDERA_PRIVATE_KEY" --gas-limit 400000 --rpc-url hedera
  ```

  The explicit `--gas-limit` is required: the relay's `eth_estimateGas` under-estimates a call that forwards
  native HBAR out of a contract, and the first attempt without it reverted. 762 bps at 100 HBAR times 0.8 is
  610 bps at 80 HBAR, which is what the second log observed.
- **The reverted defend and the INACTIVE probe.** These two are a before/after pair on the same code path.
  `1426` is the naive version that trusts the challenge contract to accept a repay; `1433` adds the `eth_call`
  probe and declines. Both run against the live position created by `join()`, so re-running `1426` today would
  revert the same way until Chainlink opens a scenario.
- **The 2026-09-12 pair ties the logs to the submitted code.** Both were produced by the exact commands in the
  index on the code in this commit, after the policy rotation and after the Nitro constraint was added: the
  `Binary hash` lines differ from every 09-10 log for that reason, the `Config hash` lines are unchanged
  (`91df4789…` for bond-monitor, `515b79e7…` for liquidation-protection) because no config moved. The first
  line of each file is `bun run`'s echo of the command.
- **Clock.** The simulator stamps lines with the machine's local time (IST, UTC+5:30) and a `Z` suffix, and the
  file names use the same local clock: `20260912-0057` was 2026-09-11 19:27 UTC. The same holds for the 09-10
  files.
- **A fresh bond-monitor run reads live state.** The coverage bucket depends on what `CollateralVault` holds at
  that moment, and the nonce depends on how many verdicts have already been applied. The verdict in a new log
  will not match the ones above.

Relaying a verdict out of a log:

```sh
relayer/scripts/extract-verdict.sh < docs/cre-evidence/bond-monitor-20260910-1533-freeze.log \
  > relayer/inbox/freeze.json
cd relayer
RISKGATE_ADDRESS=0x1dFF1d5458D6a6f6af46014de76474DC3170C31B npm run relayer -- \
  submit --file inbox/freeze.json
```

An already-applied verdict prints `{"skipped":"already-applied"}` instead of re-sending, because the relayer
re-reads `RiskGate.snapshot(bondId)` and compares the nonce first.

## Secret-leak check, run before committing any log

```sh
cd workflow
while IFS= read -r l; do case "$l" in ''|\#*) continue;; esac; v="${l#*=}"; [ ${#v} -ge 4 ] || continue
  grep -lE "(^|[^0-9A-Za-z])${v}([^0-9A-Za-z]|$)" ../docs/cre-evidence/*.log && echo "LEAK: $v"
done < .env; echo "leak check done"
```

Two details matter. The match is **word-bounded**, not a substring: a bare `grep -F` on a short numeric policy
value matches inside every unrelated number in the log and prints nothing but false hits. And values shorter
than 4 characters are skipped for the same reason — a 1 to 3 digit threshold cannot be distinguished from
coincidence, so the check would only produce noise. What is left is every private key and the longer policy
values.

Run as written against the seven logs in this directory on 2026-09-12, after the policy rotation, the check
reports **no hit**. Before the rotation it reported exactly one, and it was not a leak: the CRE simulator opens
every run with a fixed capability-limits banner (the `HTTP: … | ChainWrite … | WASM binary=…` line), whose
numbers are the simulator's own constants, byte for byte identical in every log, and one of them happened to
equal a policy value that no longer exists. Nothing the workflows themselves write matches: no `[USER LOG]`
line, no `VERDICT_JSON` field, and none of the three private keys appears anywhere.

A hit on any other line is real: delete the log, fix the offending log statement, re-run the simulation. Do not
redact by hand. A redacted log is not evidence, and the underlying log statement will leak again on the next
run. Re-run the check after any change to a log statement in `workflow/`, and once more immediately before the
submission.

## What these logs do not prove

- **They are not enclave attestations.** The simulator says so itself, in the banner at the top of every file. A
  production run in a real enclave produces no output we can capture. Nothing here proves the signing key was
  inside a TEE, only that the workflow is written to run there and behaves as specified. The missing primitive
  is discussed in `docs/FEEDBACK/chainlink.md`.
- **`don-report=ok` attests to a DON round**, not to the enclave that produced the payload.
- **They do not prove on-chain effect on their own.** That is the relay transaction table above, and the full
  storyline in the root `README.md`.
- **The workflows are deployed since 2026-09-12 06:19 UTC**, both on the private registry, and `cre execution list`
  shows the liquidation defender succeeding every 30 s; the record is `deployed-20260912.txt` and the deployment
  table in `challenge.md`. What the deployment does not prove is enclave execution: `cre execution events` shows
  no TEE capability and `cre execution logs` returns the handler's log line from every DON node, so the
  attested-execution evidence remains the simulator banners above. `workflow/scripts/defend-loop.sh` stays as the
  backup for the scoring window.

## Deployed on the CRE network (2026-09-12)

[`deployed-20260912.txt`](deployed-20260912.txt) is the raw CLI output captured at 06:22 UTC: `cre workflow list
--registry private` (two ACTIVE workflows, `bond-monitor-production` `0045bd36…5c96c8` and
`liquidation-protection-production` `00cdbaa2…48554f`), `cre execution list` for both, and for execution
`a45b819e…6537ba` its `status` (SUCCESS, 06:20:01 to 06:20:08 UTC), `events` (trigger, one `http-actions
SendRequest`) and `logs` (`liq plan=scenario-inactive (gate closed)` from nine nodes). The bond monitor is on an
hourly cron with `deliver: "direct"`, so from 07:00 UTC each run signs a verdict and lands it on Hedera itself;
the resulting `VerdictApplied` events are on RiskGate and in the app's Risk tab.
