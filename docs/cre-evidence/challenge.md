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

Chainlink runs the price scenarios during the 24 hours after the submission deadline, 2026-09-13 16:00 UTC. The
code, the wallet and the policy are the same in both branches below; what differs is where the secrets are read
from and whether the execution is attested.

**Branch A: deploy access arrives in time.** `cre secrets create secrets.yaml --target staging-settings
--secrets-auth=browser` puts the wallet key and the five policy values into the Vault DON, then
`cre workflow deploy liquidation-protection --target staging-settings` deploys to the private registry. From
then on an AWS Nitro enclave in `us-west-2` (the constraint in `main.ts`) executes the handler every 30 s, the
Vault DON releases the secrets only into that attested enclave, nothing runs on our machines, and the
deployment record (workflow name, registry, time) is appended to this file.

**Branch B: access is still pending at 16:00 UTC.** `workflow/scripts/defend-loop.sh` runs on our machine from
2026-09-13 16:00 UTC for the 24 h window. Every 30 s it executes the same handler through
`cre workflow simulate`: the same batched reads, the same gate probe, the same private decision, the same
in-process signing, and the same JSON-RPC `eth_sendRawTransaction` (the reverted `1426` transaction is the
proof that the simulator's sends are real). Stated plainly: the simulator is not an enclave, so nothing about
those runs is attested, and the secrets come from `workflow/.env` on our disk rather than from the Vault DON.
The full output goes to `workflow/.defend-logs/` (gitignored).

Which branch ran, and the Sepolia transactions it produced, are appended here after the window.

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
