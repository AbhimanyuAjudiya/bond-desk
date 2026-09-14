# Automated Liquidation Protection Challenge — participation record

Network: Ethereum Sepolia (11155111). Challenge contract `0x88574e7Cc0027afd04951daa09B64d4441931ba1`,
vETH `0x5dED1a40c3D56dA42E7f932f781c0432556c9814`, vUSD `0x6Fe92Ead5299040f50F095860b5A0A7A2D4041A2`.

Participant wallet (the workflow's `LIQ_WALLET_KEY` / `CRE_ETH_PRIVATE_KEY`):
`0x05406c5D8826E9977eAC63A237B6363DaF02942A`

| Step | Tx |
|---|---|
| approve vUSD (max) | [`0x254d6b409d2cf03060e6bf20e23dafbad0f0c52ea6ddfba758d17db3c93da193`](https://sepolia.etherscan.io/tx/0x254d6b409d2cf03060e6bf20e23dafbad0f0c52ea6ddfba758d17db3c93da193) |
| approve vETH (max) | [`0x03bb99bfa1e85d9faccd15a6ec3679471ec588249f7cdcff7f29644ea5f3b74a`](https://sepolia.etherscan.io/tx/0x03bb99bfa1e85d9faccd15a6ec3679471ec588249f7cdcff7f29644ea5f3b74a) |
| `join()` | [`0x22feaf45d88d5ffada8b10a55a4561e605326218d592d26d81e52e1977fe64a9`](https://sepolia.etherscan.io/tx/0x22feaf45d88d5ffada8b10a55a4561e605326218d592d26d81e52e1977fe64a9) |

Position right after `join()`: collateral 5.00 vETH, debt 7,000.00 vUSD, vETH price 2,000.00, health factor 1.11
(`getUserPosition` = `(500, 700000, 111, 0, 1789030524, 0)`).

Produced by `bun run setup:challenge` (`workflow/scripts/setup-challenge.ts`) on 2026-09-10.
Workflow: `workflow/liquidation-protection/main.ts`; simulation logs in this directory; deployment record appended below once
`cre workflow deploy liquidation-protection --target staging-settings` has run.

## Simulation runs (CRE CLI, local simulator)

| Log | What it shows |
|---|---|
| `liquidation-protection-20260910-1424-nodebt.log` | Before `join()`: TEE banner, position empty, `plan=no-debt`, result `SAFE`. |
| `liquidation-protection-20260910-1426-defend-reverted.log` | Right after `join()`: HF 111 ≤ private trigger, the enclave signed and broadcast `repay(1000.00 vUSD)` — tx [`0xf3e806bce55bc2ed87bd7bc3d9b7b3bbd604a4b1b4dc6f7514ace408dc7effe8`](https://sepolia.etherscan.io/tx/0xf3e806bce55bc2ed87bd7bc3d9b7b3bbd604a4b1b4dc6f7514ace408dc7effe8) **reverted with `Scenario has not started`**: the challenge contract's `onlyActive` gate only opens while Chainlink runs a scoring scenario. |
| `liquidation-protection-20260910-1433-inactive.log` | After adding an in-batch `eth_call` probe of `repay(1)`: the workflow detects the closed gate and returns `INACTIVE` without spending gas (intervention discipline). During a live scenario the same probe succeeds and the defend path runs unchanged. |
| `liquidation-protection-20260912-0057-inactive.log` | Final re-run on the submitted code, after the policy rotation below: the banner names the requested enclave (`AWS Nitro in us-west-2`), `plan=scenario-inactive (gate closed)`, `INACTIVE`, no transaction. |

Thresholds, caps and the cooldown never appear in any log; the leak check in `README.md` was run before each of
these files was added, most recently on 2026-09-12 against all seven logs (no hit).

## Policy rotation (2026-09-12)

The five private liquidation values (trigger and target health factors, repay and deposit caps, cooldown) were
replaced after the 2026-09-10 runs and before the final re-run. Until then `workflow/.env.example` carried the
live values verbatim, and the `1426` log's `repay: 100000` against `hf=111` lets a reader solve for the old
target. Consequences: the old values are in neither this repository nor `workflow/.env`; the `1426` and `1433`
logs describe a policy that is no longer in force; `.env.example` holds placeholders; `workflow/README.md`
("Choosing a policy") explains the units and constraints without giving numbers. The bond coverage ladder was
rotated at the same time, for hygiene.

## How the position is defended during scoring

Chainlink runs the price scenarios during the 24 hours after the submission deadline, 2026-09-13 16:00 UTC.

**Deployed, 2026-09-12.** Deploy access flipped to `Enabled` after a fresh `cre login` on 2026-09-12. The secrets
went to the private registry in two files (the registry caps one payload at 10 ids):
`cre secrets create liquidation-protection/secrets.yaml --target production-settings --secrets-auth=browser`
created `LIQ_WALLET_KEY`, `LIQ_TRIGGER_HF`, `LIQ_TARGET_HF`, `LIQ_MAX_REPAY_VUSD`, `LIQ_MAX_DEPOSIT_VETH`,
`LIQ_COOLDOWN_SECS` (owner `0x8070ad0f…4aBC`, namespace `main`). Then
`cre workflow deploy liquidation-protection --target production-settings`:

| | |
|---|---|
| Workflow name | `liquidation-protection-production` |
| Workflow ID | `00cdbaa2a96e93c92fefd715757d621c448fd30fa4cb4f509caaa07a4648554f` |
| Registry / DON family | private / `zone-a` |
| Status | ACTIVE, cron every 30 s |
| First executions | `2d16ed16…9053a4` 06:19:30 UTC, `a45b819e…6537ba` 06:20:01 UTC, `3ab4caa8…31bc80` 06:20:31 UTC, all `SUCCESS` (7–9 s each) |
| Evidence | [`deployed-20260912.txt`](deployed-20260912.txt): `cre workflow list`, `cre execution list`, one execution's `status`, `events` and `logs` |

Every run so far reports `liq plan=scenario-inactive (gate closed)`, which is the correct answer while no scoring
scenario is open: the probe finds `repay` reverting and the workflow spends nothing. From the first `start()` it
acts on the next tick with the private policy.

Two things the CLI shows that are worth stating plainly. `cre execution events` lists the trigger and one
`http-actions SendRequest` (the batched JSON-RPC read); it shows nothing about the enclave the `nitro`
constraint asks for, and `cre execution logs` returns the handler's coarse log line once per DON node (nine
nodes). Whether the network executed the handler inside the Nitro enclave is therefore not visible from the
CLI, and the Confidential Workflows early-access form submitted on 2026-09-10 was never confirmed. The
attested-execution claim rests on the simulator runs above, which name the enclave in their banner; the
deployment is claimed only as what it is: the same handler, running on the CRE network every 30 s during the
scoring window, with its secrets released by the Vault DON rather than read from our disk.

**Fallback, kept armed.** `workflow/scripts/defend-loop.sh` (30 s ticks through `cre workflow simulate`, secrets
from `workflow/.env`, unattested) is no longer the plan; it is the backup if the deployed workflow stops
executing before or during the window. The scoring-window outcome and the Sepolia transactions it produced are
appended here after the window.

## What the workflow does at the first tick of each scenario (current policy, qualitatively)

The workflow does not know which scenario it is in. At every tick it reads the position, the price and the two
reserve balances in one batched call, probes the gate, and compares the health factor with the private trigger.
If the position is inside the band it computes one intervention that lifts the health factor to the private
target: a repay bounded by the private cap, then a collateral deposit for whatever the cap leaves. The target is
sized so that one intervention is normally enough for an example path from the brief; a second one is a
contingency, not the plan. The trigger leaves a margin above the liquidation line for a further downward step.
Neither number is published.

- **Gradual decline.** After the first intervention, each further step is compared with the trigger. Steps that
  stay above it are held (no transaction). A step that crosses it is answered with one more proportionate
  intervention, provided the cooldown since the last debt change has elapsed.
- **Sudden crash.** The first intervention is sized with the crash's depth in mind, so the position survives even
  if no later tick can act in time. A second intervention happens only if a step crosses the trigger and the
  cooldown allows it.
- **Temporary wick.** The dip is held unless it crosses the trigger. The recovery tick is a no-op: the health
  factor is back above the trigger, and the workflow never unwinds a defence.
- **Two-stage decline.** The plateau ticks are no-ops. The last leg is answered only if it crosses the trigger.
- **Safe volatility.** After the first intervention every example tick stays above the trigger: no further
  transaction, whichever way the price swings.

Between ticks, two guards keep the action count down: a pending transaction (nonce `pending` above `latest`)
makes the tick return `PENDING` without signing, and a closed gate (the `eth_call` probe) makes it return
`INACTIVE` without spending gas.

## Live run, 14 September 2026 (written after the window closed; no workflow change since the deadline)

The Chainlink team started the scenario clock at 02:16:00 UTC (`ChallengeStarted`), reopened participant actions
at 02:43:48 UTC (`ChallengeOpened`) after a system-test period, and moved the vETH price ten times between 02:50
and 14:47 UTC: 2,000 → 2,200 → 1,900 → 1,810 → 1,750 → 1,630 → 1,500 → 1,360 → 1,220 → 1,350 → 1,500 → 1,200 →
1,130 → 1,020. `stop()` had not been called at 16:07 UTC. Everything below is on-chain or in `cre execution` output.

**Closed gate (02:17:12 to 02:43:12 UTC).** 52 executions, all `SUCCESS`, every one logging
`liq plan=scenario-inactive (probe failed)` and sending nothing; the wallet's nonce did not move. Example execution
`ab827ba0-d62e-410b-bfcd-d450601fdb54` (02:19:01 UTC). During that period the contract liquidated every joined
wallet twice; for this wallet: 02:29:12 UTC, 250.00 vUSD repaid by the protocol and 0.15 vETH seized
([`0x2931078c…7e7b`](https://sepolia.etherscan.io/tx/0x2931078c711f91cd7cc4f8ad02f4b38668591886de5c016ca12275a96e797e7b));
02:32:12 UTC, 202.50 vUSD and 0.12 vETH
([`0x706e7c0e…8073`](https://sepolia.etherscan.io/tx/0x706e7c0e53a78a21ffd80fc903eabab531252669be7d6ae51614c7d296c38073)).

**Interventions**, each one execution that sent a deposit and a repayment from inside the enclave:

| Execution (UTC) | Log | Deposit | Repay |
|---|---|---|---|
| `ba931415…cdf8` 02:44:01, 13 s after the reopen | `hf=101 plan=defend txs=2/2` | 1.19 vETH [`0x5af3ed8a…53a2`](https://sepolia.etherscan.io/tx/0x5af3ed8a93d27079825dfce171fc5648b4c05c14c44aca4bbcb68f82c35853a2) | 700.00 vUSD [`0x8c983c0e…c7d6`](https://sepolia.etherscan.io/tx/0x8c983c0ecac1168200ce48c692948f8c908e8e832d50b163203e965b02fbc7d6) |
| 04:04 (price 1,500) | `plan=defend txs=2/2` | 0.33 vETH [`0x036a5fdc…2fe2`](https://sepolia.etherscan.io/tx/0x036a5fdc1e81f9b1e9cca96975ed0d265149907c4352624bd8b91bc739ba2fe2) | 700.00 vUSD [`0x0c611484…265c`](https://sepolia.etherscan.io/tx/0x0c611484e435898203a6277153b6fa485f1f0af88ee99ee7fd8191e842a8265c) |
| `9f1516fd…6344` 12:33:01, 13 s after the 1,220 print | `hf=115 plan=defend txs=2/2` | 0.39 vETH [`0x855df77f…ddc6`](https://sepolia.etherscan.io/tx/0x855df77fabcacbb59b409adfddde472d469df2c0604929b249cc790b1537ddc6) | 700.00 vUSD [`0x3f10a696…6dd1`](https://sepolia.etherscan.io/tx/0x3f10a696f842b29fc6b07aa139e671643315b065060d46b821ac197c90a46dd1) |
| `46eafb3a…0a4b` 14:48:01, 13 s after the 1,020 print | `hf=118 plan=defend txs=2/2` | 0.05 vETH [`0x2b15a213…c124`](https://sepolia.etherscan.io/tx/0x2b15a2135169274ceca47e9051a3a5f91d8ef3e66fd926ba51515a96dd27c124) | 700.00 vUSD [`0x0a11adae…ea83`](https://sepolia.etherscan.io/tx/0x0a11adae1bc81342a814972cfc62b7aef1bcadcb5052ee987133cc7a2fa5ea83) |

Every other execution in the window logged `plan=safe` and sent nothing. No transaction from this wallet reverted.
Emergency capital consumed: 1.96 vETH and 2,800.00 vUSD.

**Position at the close (16:07 UTC, price 1,020):** collateral 6.69 vETH, debt 3,747.50 vUSD, health factor 1.42,
eight operations, never liquidated after the reopen.

**Platform outage.** From 11:34:01 to 12:02:41 UTC every run failed before the handler ran with
`confidential-workflows capability execution failed … no live enclaves available` (first failure
`fdde3b8b6637f6dad61b2c955456b186c6365da39edb8ab9b62f6bf49b7ac541`, last good run before it
`315541d7a0442b843b045c4042d21ded0afb62afadcfd01e98627b5d90602bd0`). No price update fell inside the gap. Reported
to Chainlink Labs in the ETHGlobal Discord the same day.
