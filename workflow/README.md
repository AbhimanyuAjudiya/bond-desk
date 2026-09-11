# Bond Desk — Chainlink CRE workflows

Two confidential (TEE) workflows built on `@chainlink/cre-sdk` 1.20.0:

| Workflow | Trigger | What it does |
|---|---|---|
| `bond-monitor/` | cron, every 2 min | Reads `RiskGate.snapshot(bondId)` on Hedera testnet, decides OK / WARN / FREEZE / DEFAULT against **private** coverage thresholds, signs an EIP-712 `Verdict` inside the enclave, emits it as `VERDICT_JSON …` for the relayer (or relays it itself with `deliver: "direct"`). |
| `liquidation-protection/` | cron, every 30 s | Chainlink Liquidation Protection Challenge on Sepolia: reads the position, repays just enough vUSD and tops up vETH to a **private** target health factor, signs and broadcasts the transactions from inside the enclave. |

Shared code lives in `shared/` (`rpc.ts` JSON-RPC batching over the CRE HTTP client, `tx.ts` legacy-tx signing, `verdict.ts` EIP-712 types + ABI helpers, `decide.ts` the pure policy both workflows use).

## Run it

```sh
bun --version                                  # needs >= 1.2.21
curl -sSL https://app.chain.link/cre/install.sh | bash && cre version
cre login && cre whoami                        # required even for simulate

cd workflow
cp .env.example .env                           # fill the three keys, then pick your own policy values ("Choosing a policy" below)
bun install
bun test                                       # decide ladder + liquidation math + fake-runtime handler test
bun run typecheck

mkdir -p ../docs/cre-evidence
bun run sim:bond 2>&1 | tee ../docs/cre-evidence/bond-monitor-$(date +%Y%m%d-%H%M).log
bun run sim:liq  2>&1 | tee ../docs/cre-evidence/liquidation-protection-$(date +%Y%m%d-%H%M).log

# FREEZE demo: raise the private freeze floor above the bond's coverage; only the verdict changes.
CRE_BOND_FREEZE_BPS=99999 bun run sim:bond 2>&1 | tee ../docs/cre-evidence/bond-monitor-freeze-$(date +%Y%m%d-%H%M).log

# Liquidation challenge, once, from the CRE_ETH_PRIVATE_KEY wallet: approve vUSD/vETH, then join().
bun run setup:challenge                        # record the join tx hash in docs/cre-evidence/challenge.md

# Secrets to the private registry, then deploy (needs Chainlink deploy access).
cre secrets create secrets.yaml --target staging-settings --secrets-auth=browser
cre secrets list --target staging-settings --secrets-auth=browser
cre workflow deploy liquidation-protection --target staging-settings
cre workflow list --registry private
```

Before committing any simulation log, make sure nothing from `.env` leaked into it:

```sh
while IFS= read -r l; do case "$l" in ''|\#*) continue;; esac; v="${l#*=}"; [ ${#v} -ge 4 ] || continue
  grep -lE "(^|[^0-9A-Za-z])${v}([^0-9A-Za-z]|$)" ../docs/cre-evidence/*.log && echo "LEAK: $v"
done < .env; echo "leak check done"
```

The match is word-bounded and values under 4 characters are skipped: a plain substring grep on a short numeric threshold hits inside every unrelated number in the log. `docs/cre-evidence/README.md` has the full check and its history: it used to report one benign hit from the simulator's fixed banner, and since the 2026-09-12 policy rotation it reports none.

Both committed configs (`bond-monitor/config.staging.json` and `config.production.json`) already point `riskGate` at the testnet deployment `0x1dFF1d5458D6a6f6af46014de76474DC3170C31B`; change it only if you redeploy `RiskGate` (the address is in `deployments/testnet.json`).

## Choosing a policy

The eight policy values are private inputs and are not in this repository: `.env.example` carries placeholders, the live numbers exist only in `workflow/.env` (gitignored) and, once deployed, in the Vault DON. The fixtures in `shared/decide.test.ts` and `bond-monitor/handler.test.ts` are deliberately not the live values. Units and constraints, so you can pick your own:

| Variable | Unit | Constraint |
|---|---|---|
| `CRE_BOND_WARN_BPS` | coverage in bps (10000 = 100%) | above `FREEZE`; WARN fires below it |
| `CRE_BOND_FREEZE_BPS` | bps | FREEZE fires below it |
| `CRE_BOND_DEFAULT_BPS` | bps | floor for DEFAULT; `0` disables it (the demo policy does) |
| `CRE_LIQ_TRIGGER_HF` | health factor ×100 (`100` = liquidation) | above `100`, with a margin for the next downward price step |
| `CRE_LIQ_TARGET_HF` | ×100 | above `TRIGGER`; the level one intervention restores |
| `CRE_LIQ_MAX_REPAY_VUSD` | vUSD, 2 decimals (`100` = 1.00 vUSD) | per-intervention repay cap; `decideLiq` repays first up to this cap, then deposits the remainder, so a small cap shifts the defence to collateral and keeps the debt (loan continuity) intact |
| `CRE_LIQ_MAX_DEPOSIT_VETH` | vETH, 2 decimals | per-intervention deposit cap |
| `CRE_LIQ_COOLDOWN_SECS` | seconds since the last debt change | at least the cron period (30 s) |

The demo bond sits in the hundreds of bps (faucet-sized collateral), so its ladder is small. The challenge position starts at health factor 1.11 with 5.00 vETH and 7,000.00 vUSD in reserve, and the contract liquidates at or below 1.00. Every value is parsed with `policyInt`, which rejects anything that is not an unsigned integer without echoing it, so a bad `.env` cannot leak a value through an error message.

## What stays inside the enclave

Both handlers are registered with `handlerInTee`, so everything in the handler body runs in the TEE:

- **Secrets** — fetched in one batched `getSecrets` call: the verdict signer key, the Hedera submit key (direct mode only), the three coverage thresholds; for the challenge the wallet key and the five HF policy values. They never appear in logs, return values, or HTTP bodies (the fake-runtime test in `bond-monitor/handler.test.ts` asserts this for every secret value).
- **The decision** — `shared/decide.ts` is pure; the only public trace is the coarse coverage bucket (`>=150% | 120-150% | 100-120% | <100%`) and the action name in the log line.
- **Signing** — `privateKeyToAccount(...).signTypedData` / `.signTransaction` from viem execute inside the enclave; signatures leave, keys do not.

What leaves: the public verdict (bond id, action, observed coverage, issuedAt, nonce), its signature, and optionally a 32-byte digest handed to the DON via `runtime.usingTheDons().report(...)` (`donReport: true`) — the same fields that end up on-chain anyway.

Time comes from `runtime.now()` only; no `Date.now`, no `Math.random` (the SDK's determinism scan runs clean on both entry points).

## Why Hedera over JSON-RPC, and why a relayed EIP-712 verdict

Hedera is **not a CRE-supported chain**, so the EVM capability (`EVMClient`, `runtime.report` + forwarder) cannot read or write it. Inside the TEE the only I/O primitive is `HTTPClient.sendRequest`, so `shared/rpc.ts` speaks JSON-RPC to `https://testnet.hashio.io/api` directly and packs every read into one batch request (one HTTP call). The budget is 5 HTTP calls per execution; bond-monitor uses 1 (return mode) or 2 (direct mode: batch of reads + `eth_sendRawTransaction`), liquidation-protection uses 2 (one batch of nine sub-calls — eight reads plus the `onlyActive` probe — then a batch of 1–2 sends).

Because no Chainlink forwarder exists on Hedera, the verdict has to carry its own proof: it is an EIP-712 `Verdict(uint256 bondId,uint8 action,uint256 coverageObserved,uint64 issuedAt,uint64 nonce)` under domain `{ BondDeskRiskGate, "1", 296, <RiskGate> }`, signed by a key that only exists as a CRE secret. `RiskGate.submit` recovers the signer, checks `nonce > lastNonce` (strictly increasing) and freshness, and applies the action — the workflow always signs `lastNonce + 1`, but the contract only requires the nonce to increase — so *anyone* can relay it (the `relayer/` CLI, or the enclave itself in direct mode) and nobody can forge or replay it. The relayer reads the `VERDICT_JSON {…}` log line verbatim:

```json
{ "verdict": { "bondId": "1", "action": 2, "coverageObserved": "10500", "issuedAt": "1789012345", "nonce": "5" },
  "signature": "0x…", "chainId": 296, "riskGate": "0x…", "txHash": null }
```

## Scoring window fallback

Chainlink scores the liquidation challenge by running price scenarios against the live contract during the 24 hours after the submission deadline, **2026-09-13 16:00 UTC**. A deployed workflow would defend the position from an enclave; ours is not deployed (deploy access requested 2026-09-10, not enabled as of 2026-09-11). Until access lands, `scripts/defend-loop.sh` is the stand-in:

```sh
cd workflow
scripts/defend-loop.sh --once        # smoke test: one tick, prints the decision, exits
scripts/defend-loop.sh               # from 2026-09-13 16:00 UTC, for 24 h, until Ctrl-C
```

What it does: every 30 s (`DEFEND_INTERVAL`) it runs `cre workflow simulate liquidation-protection …`, which executes the real handler once: the batched reads, the gate probe, the private decision, in-process signing and the JSON-RPC `eth_sendRawTransaction`. The simulator's HTTP sends are real; the reverted 2026-09-10 repay in `docs/cre-evidence/` proves it. A failed tick (auth backend 500, RPC timeout, compile hiccup) is logged and retried at the next tick. On macOS it re-executes itself under `caffeinate -i` so the machine does not idle-sleep; run it inside `tmux`/`screen` or under `nohup` so a closed terminal does not stop it. Full simulator output goes to `workflow/.defend-logs/` (gitignored); the terminal shows the decision lines per tick. Auth: the CLI uses the cached `cre login` session; if `CRE_API_KEY` is set the CLI uses it instead, but the docs gate API keys behind deploy-access approval, so for us it is the cached session.

Disclosure: this is a fallback, not the design. The simulator is not a TEE, so nothing about these runs is attested, and the secrets, wallet key and policy alike, are read from `workflow/.env` on our machine instead of being released by the Vault DON into an enclave. The moment deploy access arrives we run `cre secrets create` + `cre workflow deploy` and stop the loop. Keep the Sepolia wallet funded: each intervention is up to two transactions at a 150,000 gas limit.

## Known limits

- **DEFAULT is a floor, not a grace period.** Runs are stateless, so DEFAULT fires when coverage drops below `BOND_DEFAULT_BPS` (0 disables it); anything time-based is an admin action on-chain.
- **WARN is re-sent every run** while coverage sits between the warn and freeze floors; FREEZE/DEFAULT are suppressed once the bond is already Frozen/Defaulted (`shouldDeliver`). A stale price feed (`feedFresh == false`) logs `feed-stale` and returns without signing.
- **hashio is a public dev RPC**: single batch per run with a 9 s timeout; if it ever rejects batches, split into sequential calls (still ≤ 5).
- `cre workflow simulate` needs `cre login` and `CRE_ETH_PRIVATE_KEY` in `.env` even for the Hedera workflow; the simulator is not a real TEE (it says so in its banner, right under the constraint it resolved, `AWS Nitro in us-west-2`) — the production deployment is.
- **Production emits no logs.** User logs inside a confidential handler never leave a real enclave, so the `VERDICT_JSON` line the relayer reads exists only in the simulator. A deployed bond-monitor must deliver its own verdict, which `config.production.json` does with `deliver: "direct"`; relay mode (`deliver: "return"`) is for simulation and for the evidence logs.
