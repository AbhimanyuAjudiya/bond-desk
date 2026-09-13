# Recipe — "Best Eligible Hedera Bond Recommendation"

**Published:** <https://bazantic.com/recipes/best-eligible-hedera-bond-recommendation>
(handle `best-eligible-hedera-bond-recommendation`; the handle is derived from the name and immutable, so the name
never changes). Recipes are authored in the bazantic.com dashboard; this file is the source text and the operator
notes; the click list that put this version into the published Recipe is kept with the recording notes, outside the repository.

Three gateways, all ours, all active (`gateway.md` steps 4–6c). A gateway URL is a subdomain per slug:

| Service | Gateway | Tools bound |
|---|---|---|
| Hedera Mirror Node (testnet) | `MIRROR = https://txrkgk2mezhbln4aeo2tdji6s4.bazgateway.com` (slug `txrkgk2mezhbln4aeo2tdji6s4`) | `getAccount`, `getTransactions` |
| Bond Desk API (Hedera) | `BOND_DESK = https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com` (slug `axuvor5zujgk5hdcydzjdi742m`) | `getWalletEligibility`, `listBonds`, `getBondRisk`, `getOrderbook` |
| Bank of Canada Valet | `BOC = https://4q4fqndwcnhxrfk6thlgjnodca.bazgateway.com` (slug `4q4fqndwcnhxrfk6thlgjnodca`) | `getGroupObservations` |

The mirror-node gateway is our own **testnet** registration: the pre-existing "Hedera Mirror Node" service is
mainnet-only and 404s for testnet wallets, and a tool 404 aborts the whole Recipe run (`tool_failed`). Input: one
Hedera EVM wallet address (`wallet_address`).

---

## Title

**Best Eligible Hedera Bond Recommendation**

## When to use this

Use this Recipe whenever a user asks which tokenized bond a specific Hedera wallet can actually buy — "what bond
should 0x… buy", "is this wallet allowed to hold that bond token", "find me the best yield on Hedera testnet for this
address". Do **not** use it for generic market questions with no wallet in them; call `listBonds` alone for those.

The point of the Recipe is that "best yield", "allowed to buy" and "worth buying" are three different questions and
the middle one gates the first. A transfer-agent-issued bond reverts the fill on-chain if the buyer is not KYC'd, so a
recommendation that ignores eligibility is a recommendation to waste gas; and a corporate coupon that does not clear
the sovereign benchmark is not a recommendation at all.

## Why three services

- **Hedera Mirror Node (testnet)** answers *does this wallet exist on Hedera, can it pay for gas, and what has it
  done*. An EVM address that has never been used has no Hedera account; nothing on-chain will work for it, and no
  amount of KYC changes that. Its transaction history is the wallet's own record — a fill that reverted, an
  association, the funding transfer — and nothing else in the flow has it.
- **Bond Desk API** (this project's gateway) answers *what do the compliance layer and the risk layer say* — ATS KYC
  status per bond, the current order book, collateral coverage, and the last risk verdict signed inside a Chainlink
  CRE enclave. That state exists nowhere else.
- **Bank of Canada Valet** answers *is the coupon worth it* — the Government of Canada benchmark curve, keyless and
  daily, from which the Recipe computes each candidate's spread over the benchmark for its remaining life. The Bond
  Desk API knows a bond's yield, not whether a risk-free instrument pays more.

No single service can answer the user's question; remove any one and the answer changes.

## Inputs

- `wallet_address` — required, a 0x-prefixed 20-byte EVM address on Hedera testnet.

## Outputs

A short recommendation naming one bond, its yield, its ask price, its spread over the benchmark (series, value, date),
its collateral coverage, its risk status and last verdict, a HashScan link, the wallet's account id, balance and recent
activity, and an explicit list of what was excluded and why.

## Steps

1. **Does the wallet exist on Hedera?** — Mirror Node `getAccount` (`GET {MIRROR}/api/v1/accounts/{walletAddress}`).
   A `404` is terminal: stop and reply that this address has no Hedera account yet and must be created and funded
   before it can hold or buy anything. On `200`, keep `account` (the `0.0.x` id) and `balance.balance` (tinybar;
   `1e8` = 1 HBAR). A balance under 1 HBAR is a warning in the answer, not a disqualification.

2. **What has it done on-chain?** — Mirror Node `getTransactions`
   (`GET {MIRROR}/api/v1/transactions?account.id={account}&limit=5&order=desc`).
   `account.id` must be the `0.0.x` id from step 1, never the 0x address: the endpoint answers `200` with an empty
   list for an EVM address (verified 2026-09-11). Keep the number of transactions returned and, for the newest,
   `name`, `result`, `consensus_timestamp` and `transaction_id`. If the only transaction is the `CRYPTOTRANSFER` that
   funded the account, the wallet has never sent a transaction — say so. A `result` other than `SUCCESS` is quoted
   verbatim. This data reaches the answer unchanged; the Bond Desk API cannot produce it.

3. **What is this wallet allowed to hold?** — Bond Desk `getWalletEligibility`
   (`GET {BOND_DESK}/wallets/{walletAddress}/eligibility`).
   First check that the response's `address` equals the wallet you asked about (case-insensitive). If it does not,
   retry once, and if it still mismatches, stop and say so rather than concluding from it. Keep only the entries with
   `canHold: true`. Each excluded entry carries a `reason` — `no-kyc`, `no-hedera-account`, or `bond-not-active` —
   and every exclusion must appear in the final answer. If nothing has `canHold: true`, stop and explain the reasons;
   the on-chain order book rejects a non-KYC fill at the contract level, so the wallet needs KYC from the issuer's
   compliance officer first.

4. **Which of those are candidates?** — Bond Desk `listBonds` (`GET {BOND_DESK}/bonds`).
   Restrict to the bond ids kept in step 3, then to `status == "Active"`. Drop any bond whose `bestAsk` is `0` — no
   ask means nothing to buy right now — and report it as "no offers on the book" rather than silently dropping it.
   Keep `symbol`, `currentYieldBps`, `bestAsk`, `maturity` (unix seconds) and `links.token` for each candidate.

5. **Which candidate clears the benchmark, and by how much?** — Bank of Canada Valet `getGroupObservations`
   (`GET {BOC}/valet/observations/group/bond_yields_all/json?recent=1`).
   The single observation row is the Government of Canada benchmark curve. Take its date `d` and, per candidate, the
   average-yield series for the bond's remaining life (`maturity` minus today):

   | Remaining life | Series |
   |---|---|
   | under 3 years | `CDN.AVG.1YTO3Y.AVG` |
   | 3 to 5 years | `CDN.AVG.3YTO5Y.AVG` |
   | 5 to 10 years | `CDN.AVG.5YTO10Y.AVG` |
   | 10 years or more | `CDN.AVG.OVER.10.AVG` |

   `v` is percent per annum: `benchmarkBps = round(v × 100)`, `spread = currentYieldBps − benchmarkBps`. Rank the
   candidates by spread descending; break ties by the lower `bestAsk`. A candidate whose spread is zero or negative
   does not clear the risk-free benchmark: exclude it with that reason — it is eligible but not a buy. If `d` is more
   than 7 days old, say the benchmark is stale and rank by `currentYieldBps` instead. Credit the Bank of Canada as the
   source (its terms of use ask for it; every response carries the `terms` link).

6. **Is the top candidate safe to recommend right now?** — Bond Desk `getBondRisk` (`GET {BOND_DESK}/bonds/{id}/risk`).
   Read `status`, `coverageBps` and `lastVerdict`. `status` is the bond's current on-chain state and the only thing
   here that can disqualify it. `lastVerdict` is the last verdict ever recorded — history and context; nothing clears
   it, so an old FREEZE can sit on a bond that has since been unfrozen.
   - `status == "Frozen"` → skip this bond, go back to the next candidate from step 5, and say it is frozen, quoting
     `coverageBps` and, if present, `lastVerdict.action` and `lastVerdict.nonce`.
   - `status == "Matured"` or `"Defaulted"` → skip; terminal.
   - `lastVerdict.action` FREEZE or DEFAULT while `status == "Active"` → still recommendable; the freeze was lifted.
     The answer must say the risk monitor froze it at nonce `lastVerdict.nonce` and quote the current `coverageBps`.
   - `lastVerdict.action` WARN → recommendable; the answer must say the monitor flagged it and quote `coverageBps`.
   - `lastVerdict == null` → say no verdict has been recorded yet rather than implying the bond is clean.

7. **Only if the user asks about depth** — Bond Desk `getOrderbook` for the recommended bond.

8. **Answer.** One short paragraph plus the numbers:
   bond symbol and id · `currentYieldBps` as a percentage · `bestAsk` (settlement units per whole bond token) · the
   benchmark series, its value, its date and the spread in bps, credited to the Bank of Canada · `coverageBps` as a
   percentage · risk status and last verdict action · the HashScan link from `links.token` · then the wallet: Hedera
   account id, HBAR balance and whether it covers gas, and the recent activity from step 2 (count, newest transaction's
   name, result, time and id) · then every bond excluded in steps 3–6 with its reason. Say plainly if no bond is
   eligible or none clears the benchmark.

## Failure modes

- **404 in step 1** → the address has no Hedera account. Terminal; steps 2–8 are meaningless.
- **Empty list in step 2** → almost always the 0x address was passed instead of the `0.0.x` id; re-run with the id.
  A genuinely empty history on an existing account is impossible (the funding transfer is always there).
- **Empty `canHold` set in step 3** → the wallet is not KYC'd on any active bond. Say so, name the issuer's KYC step,
  do not recommend anything.
- **Every candidate at or below the benchmark in step 5** → report the best-spread bond with its negative spread and
  say nothing on the desk beats the risk-free rate for its tenor right now. Eligible is not the same as worth buying.
- **Benchmark stale or the Valet call fails** → the ranking falls back to `currentYieldBps` and the answer must say
  the benchmark was unavailable; never quote a benchmark you did not fetch.
- **All candidates frozen or matured in step 6** → report the freeze and its coverage number; a frozen bond is a live
  risk signal, not an error.
- **Empty book (`bestAsk == 0`) on every candidate** → report the best bond by coupon rate and say there is no ask to
  lift.
- **502 `{"error":"upstream", "detail":"<method>"}` from Bond Desk** → the Hedera RPC or mirror node is failing.
  Retry once; if it fails again, say the chain data is unavailable rather than guessing.
- **402 on any call** → the calling account has no USDC balance or `--max-amount` is below the operation price. A
  payment problem, not a data problem; surface it verbatim.
- **Mirror-node lag** → the mirror node trails consensus by roughly 2–5 seconds. A fill from a few seconds ago may not
  be in the transaction list yet. Never contradict `GET /bonds/{id}` (live `eth_call` state) with mirror-node history.

## Example run

### Hand-derived expected result, chain state as of 2026-09-11 19:33 UTC

The chain is live and other demo steps run on it, so re-derive these numbers right before a test run (the commands are
the direct-API equivalents of each tool; every value below came from them at the stated time).

**Wallet `0x8524F940EddC9EA98198Ee08071944a07C417D7b` (KYC) — 6 tool calls expected**

| Step | Tool | Result |
|---|---|---|
| 1 | `getAccount` | account `0.0.10455958`, 852,528,004 tinybar (8.53 HBAR; it was 10 HBAR before the demo fills of 19:24–19:28 UTC) |
| 2 | `getTransactions` (`account.id=0.0.10455958`) | 4 transactions; newest `ETHEREUMTRANSACTION`, `SUCCESS`, `1789154892.654168427` (2026-09-11T19:28:12Z), id `0.0.7314364-1789154886-841148718` |
| 3 | `getWalletEligibility` | `address` matches; bond 1 `canHold: true` (`kyc-granted`); `hbarSufficientForGas: true` |
| 4 | `listBonds` | bond 1 `BDB27`, `Active`, yield 505 bps, best ask 990000, best bid 0, maturity 1820569075 (2027-09-10) → remaining life ≈ 1 year → bucket 1–3y |
| 5 | `getGroupObservations` (`bond_yields_all`, `recent=1`) | `d` 2026-09-10, `CDN.AVG.1YTO3Y.AVG` 3.30 → 330 bps → spread **+175 bps** (also on the row: 2y 3.31, 5y 3.63, 10y 3.94) |
| 6 | `getBondRisk` (bond 1) | `Active`, coverage 595 bps, `lastVerdict` WARN at nonce 3 (observed coverage 595, 2026-09-12T01:10:42Z, delivered by the enclave directly); the FREEZE at nonce 2 is older history and no longer the last verdict. From 07:00 UTC on 2026-09-12 the deployed hourly monitor advances the nonce, so expect a higher nonce on the day of the run |

Expected answer: recommend **BDB27 (bond 1)** — yield 5.05 %, ask 990000, +175 bps over the Government of Canada
1–3 year average yield (3.30 % on 2026-09-10, Bank of Canada), coverage 5.95 %, status Active, last verdict WARN at
nonce 3 (or the hourly monitor's latest) disclosed, HashScan link
<https://hashscan.io/testnet/contract/0x0100526434C821d0df24f6CC60352F830F8b4504>; wallet `0.0.10455958`, 8.53 HBAR,
gas covered, 4 transactions on record with the newest quoted; no exclusions. Thin coverage and the empty bid side are
the caveats worth a sentence.

**Wallet `0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3` (no KYC) — 3 tool calls expected**

| Step | Tool | Result |
|---|---|---|
| 1 | `getAccount` | account `0.0.10455959`, 994,818,742 tinybar (9.95 HBAR) |
| 2 | `getTransactions` (`account.id=0.0.10455959`) | 2 transactions; newest `ETHEREUMTRANSACTION`, `SUCCESS`, `1789033764.684969104` (2026-09-10T09:49:24Z), id `0.0.7314364-1789033760-568296255` |
| 3 | `getWalletEligibility` | bond 1 `canHold: false`, reason `no-kyc` → stop |

Expected answer: no bond can be held; bond 1 (BDB27) excluded for `no-kyc`; the wallet exists (`0.0.10455959`,
9.95 HBAR, gas covered, 2 transactions on record) and needs KYC from the issuer's compliance officer before the order
book will accept a fill from it. Steps 4–6 must not run.

### Dashboard test runs, 2026-09-12 10:20 UTC (three services, seven bindings)

Both wallets were run from the dashboard's Test panel and checked number by number against the direct endpoints;
the tool-call tables, the verbatim answers and one recorded deviation are in [`test-runs-20260912.md`](test-runs-20260912.md).
Run 1's answer is the published `output_example`.

### Republished, 2026-09-12 06:43 UTC (three services, seven bindings)

Applied through the control MCP with the CLI session (status note): unpublish at 06:43:41,
update with the four fields of `recipe-update.json` at 06:43:42, publish at 06:43:43 with live binding validation.
`GET https://api.bazantic.com/v1/recipes/best-eligible-hedera-bond-recommendation` now returns the three-service
description and the hand-derived `output_example`; the dashboard test runs below replace that example with a real
run.

### Previous version — dashboard test run, 2026-09-11 (two services, four tool calls)

Run from the Bazantic dashboard with the operator credential (no payment charged), wallet
`0x8524F940EddC9EA98198Ee08071944a07C417D7b`: **4 tool calls, 43 s** — `getAccount` (account `0.0.10455958`,
10 HBAR), `getWalletEligibility` (`canHold: true`), `listBonds` (BDB27, Active, 505 bps, ask 990000), `getBondRisk`
(coverage 606 bps, FREEZE at nonce 2). The answer recommended BDB27, disclosed the FREEZE as lifted, and flagged the
thin coverage and the empty bid side. Direct-API transcripts for the A/B arms are in `docs/bazantic-ab/`.

---

## Operator notes (not part of the Recipe text)

- Seven bindings, six calls on the happy path: `getWalletEligibility` already folds the ATS KYC read, the bond status,
  the HBAR balance and the token relationships together, so the mirror-node steps carry only what the API cannot
  return — existence with the `0.0.x` id (step 1) and the transaction history (step 2). `getOrderbook` stays bound
  for the depth question and is otherwise never called.
- Cost per run at the live prices: Bond Desk `1000 + 500 + 1000 = 2500` mcents ($0.025) + mirror node `2 × 1000`
  ($0.02) + Bank of Canada Valet `1000` ($0.01) = **$0.055**.
- The benchmark step is a ranking rule, not decoration: with several eligible bonds of different tenors, spread over
  the matched bucket orders them differently from raw yield, and a zero-or-negative spread removes a bond from the
  recommendation. With one bond on the desk it still changes the answer's content (the spread line) and can still
  refuse (a coupon below 3.30 % would not clear the 1–3 year average today).
- The currency mismatch is deliberate and stated: the desk settles in a USD-denominated testnet stablecoin, the curve
  is CAD. Valet was chosen because it is keyless, daily and was on neither Bazantic nor a sponsor's list
  (`gateway.md`, 6c); the spread is a relative-value sanity check for the agent, not a hedgeable basis.
- Step 6's loop back into step 5 is the only branch. Keep it — it is what makes the frozen-bond demo land: the relayed
  CRE verdict flips `status` to `Frozen`, and the Recipe's answer changes without the Recipe changing.
- The skip is gated on `status`, never on `lastVerdict`. An admin unfreeze cannot emit a new verdict —
  `RiskGate.submit` needs an EIP-712 signature from the enclave key — so a bond carries its last FREEZE verdict
  forever. Gating on the verdict would disqualify the bond permanently after one demo freeze.
- If the demo needs a guaranteed freeze, run the `CRE_BOND_FREEZE_BPS=99999` simulation and relay the verdict
  (the demo's freeze beat) before asking the agent the Recipe question; the unfreeze comes after.
