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
cp .env.example .env                           # fill CRE_ETH_PRIVATE_KEY, CRE_VERDICT_SIGNER_KEY, CRE_BOND_*_BPS
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

The match is word-bounded and values under 4 characters are skipped: a plain substring grep on a short numeric threshold hits inside every unrelated number in the log. `docs/cre-evidence/README.md` has the full check, including the one benign hit inside the simulator's own banner.

Both committed configs (`bond-monitor/config.staging.json` and `config.production.json`) already point `riskGate` at the testnet deployment `0x1dFF1d5458D6a6f6af46014de76474DC3170C31B`; change it only if you redeploy `RiskGate` (the address is in `deployments/testnet.json`).

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

## Known limits

- **DEFAULT is a floor, not a grace period.** Runs are stateless, so DEFAULT fires when coverage drops below `BOND_DEFAULT_BPS` (0 disables it); anything time-based is an admin action on-chain.
- **WARN is re-sent every run** while coverage sits between the warn and freeze floors; FREEZE/DEFAULT are suppressed once the bond is already Frozen/Defaulted (`shouldDeliver`). A stale price feed (`feedFresh == false`) logs `feed-stale` and returns without signing.
- **hashio is a public dev RPC**: single batch per run with a 9 s timeout; if it ever rejects batches, split into sequential calls (still ≤ 5).
- `cre workflow simulate` needs `cre login` and `CRE_ETH_PRIVATE_KEY` in `.env` even for the Hedera workflow; the simulator is not a real TEE (it says so in its banner) — the production deployment is.
