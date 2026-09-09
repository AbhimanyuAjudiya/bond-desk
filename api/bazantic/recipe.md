# Recipe — "Best eligible Hedera bond for a wallet"

Recipes are authored in the bazantic.com UI. Everything between the two rules below is the text to paste into
the Recipe body; the rest of this file is operator notes that stay in the repo.

Prerequisites: both gateways are active and callable (`api/bazantic/gateway.md` steps 4–6b). Substitute the two
slugs before pasting — the Recipe body must contain real, resolvable URLs.

- `BOND_DESK = https://bazgateway.com/<bond-desk-slug>`
- `MIRROR = https://bazgateway.com/<hedera-mirror-node-slug>`

---

## Title

**Best eligible Hedera bond for a wallet**

## When to use this

Use this Recipe whenever a user asks which tokenized bond a specific Hedera wallet can actually buy — phrasings
like "what bond should 0x… buy", "is this wallet allowed to hold that bond token", "find me the best yield on Hedera
testnet for this address". Do **not** use it for generic market questions with no wallet in them; call
`GET /bonds` alone for those.

The point of the Recipe is that "best yield" and "allowed to buy" are different questions and the second one
gates the first. A transfer-agent-issued bond will revert the fill on-chain if the buyer is not KYC'd, so a
recommendation that ignores eligibility is a recommendation to waste gas.

## Why two services

- **Hedera Mirror Node** (existing Bazantic service) answers *does this wallet exist on Hedera and can it pay
  for gas*. An EVM address that has never been used has no Hedera account; nothing on-chain will work for it,
  and no amount of KYC changes that.
- **Bond Desk API** (this project's gateway) answers *what does the compliance layer and the risk layer say* —
  ATS KYC status per bond, current order book, collateral coverage, and the last risk verdict signed inside a
  Chainlink CRE enclave. That state does not exist on the mirror node.

Neither service alone can answer the user's question.

## Inputs

- `walletAddress` — required, a 0x-prefixed 20-byte EVM address on Hedera testnet.

## Outputs

A short recommendation naming one bond, its yield, its ask price, its collateral coverage, its risk status, a
HashScan link, and an explicit list of what was excluded and why.

## Steps

1. **Does the wallet exist on Hedera?**
   `GET {MIRROR}/api/v1/accounts/{walletAddress}`
   A `404` is terminal: stop and reply that this address has no Hedera account yet and must be created and
   funded before it can hold or buy anything. Do not continue to step 2.
   On `200`, keep `account` (the `0.0.x` id) and `balance.balance` (tinybar; `1e8` = 1 HBAR).

2. **Can it pay for gas, and what does it already hold?**
   `GET {MIRROR}/api/v1/accounts/{walletAddress}/tokens?limit=100`
   Keep the token ids and balances. Note whether the HBAR balance from step 1 is below `1e8` tinybar (1 HBAR) —
   that is roughly the floor for a fill at Hedera testnet gas prices, and it belongs in the answer as a warning,
   not as a disqualification.

3. **What is this wallet allowed to hold?**
   `GET {BOND_DESK}/wallets/{walletAddress}/eligibility`
   Keep only the entries with `canHold: true`. Each excluded entry carries a `reason` —
   `no-kyc`, `no-hedera-account`, or `bond-not-active` — and every exclusion must appear in the final answer.
   If nothing has `canHold: true`, stop and explain the reasons; do not recommend a bond the wallet cannot buy.

4. **Which of those is the best buy?**
   `GET {BOND_DESK}/bonds`
   Restrict to the bond ids kept in step 3, then to `status == "Active"`. Sort by `currentYieldBps` descending;
   break ties by the lower `bestAsk`. Drop any bond whose `bestAsk` is `0` — no ask means nothing to buy right
   now, and it should be reported as "no offers on the book" rather than silently dropped.

5. **Is the top candidate safe to recommend right now?**
   `GET {BOND_DESK}/bonds/{id}/risk`
   Read `status`, `coverageBps`, and `lastVerdict`. `status` is the bond's current on-chain state and is the
   only thing here that can disqualify it. `lastVerdict` is the last verdict ever recorded — history, and
   context for the answer; nothing clears it, so an old FREEZE can sit on a bond that has since been unfrozen.
   - `status == "Frozen"` → skip this bond entirely, go back to the next candidate from step 4, and say it is
     frozen, quoting `coverageBps` and, if present, `lastVerdict.action` and `lastVerdict.nonce`.
   - `status == "Matured"` or `"Defaulted"` → skip; these are terminal.
   - `lastVerdict.action == 2` (FREEZE) or `3` (DEFAULT) while `status == "Active"` → still recommendable, the
     freeze has been lifted. The answer must say the risk monitor froze it at nonce `lastVerdict.nonce` and
     quote the current `coverageBps`.
   - `lastVerdict.action == 1` (WARN) → still recommendable, but the answer must say that the risk monitor
     flagged it and quote `coverageBps`.
   - `lastVerdict == null` → say that no verdict has been recorded yet rather than implying the bond is clean.

6. **Answer.** One short paragraph plus the numbers:
   bond symbol and id · `currentYieldBps` as a percentage · `bestAsk` (settlement units per whole bond token) ·
   `coverageBps` as a percentage · risk status and last verdict action · the HashScan link from
   `links.token` · then a one-line list of every bond excluded in steps 3–5 with its reason. Close with the
   HBAR-balance warning from step 2 if it applied.

## Failure modes

- **404 in step 1** → the address has no Hedera account. Terminal; steps 2–6 are meaningless.
- **Empty `canHold` set in step 3** → the wallet is not KYC'd on any active bond. Say so, name the issuer's KYC
  step, do not recommend anything.
- **All candidates frozen or matured in step 5** → report the freeze and its coverage number; a frozen bond is a
  live risk signal, not an error.
- **Empty book (`bestAsk == 0`) on every candidate** → report the best bond by coupon rate and say there is no
  ask to lift.
- **502 `{"error":"upstream", "detail":"<method>"}` from Bond Desk** → the Hedera RPC or mirror node is failing.
  Retry once; if it fails again, say the chain data is unavailable rather than guessing.
- **402 on any call** → the calling account has no USDC balance or `--max-amount` is below the operation price.
  This is a payment problem, not a data problem; surface it verbatim.
- **Mirror-node lag** → the mirror node trails consensus by roughly 2–5 seconds. A fill from a few seconds ago
  may not be in `trades` yet. Never contradict `GET /bonds/{id}` (live `eth_call` state) with mirror-node
  history.

## Example run

_To be filled in after deployment with a real transcript: input wallet, the five calls in order, the total x402
spend in USDC, and the final answer. Recorded as `docs/bazantic-ab/B-run1.md`._

---

## Operator notes (not part of the Recipe text)

- The Recipe is deliberately five calls, not more: `getWalletEligibility` already folds the ATS KYC read and the
  bond status together, so there is no separate per-bond KYC call.
- Cost per run on our gateway: `10000` (eligibility) + `5000` (bonds) + `10000` (risk) = `25000` USDC base units
  = $0.025, plus the two mirror-node calls.
- Step 5's loop back into step 4 is the only branch. Keep it — it is what makes the frozen-bond demo land: the
  relayed CRE verdict flips `status` to `Frozen`, and the Recipe's answer changes without the Recipe changing.
- The skip is gated on `status`, never on `lastVerdict`. An admin unfreeze cannot emit a new verdict —
  `RiskGate.submit` needs an EIP-712 signature from the enclave key — so a bond carries its last FREEZE verdict
  forever. Gating on the verdict would disqualify the bond permanently after one demo freeze.
- If the demo needs a guaranteed freeze, run the `CRE_BOND_FREEZE_BPS=99999` simulation and relay the verdict
  (`docs/DEMO.md`, segment 5) before asking the agent the Recipe question; the unfreeze comes after.
