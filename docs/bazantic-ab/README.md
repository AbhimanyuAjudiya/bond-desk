# Bazantic A/B: does the Recipe change what the agent does?

**Status: run on 2026-09-10 against the live API.** Eight scored runs plus one isolated re-run; transcripts are in
this directory. The claim under test is narrow and falsifiable: **without the Recipe, an agent either recommends a
bond the wallet cannot buy or refuses a bond it can.**

## Setup

Identical prompt, identical model and settings, identical tool access in both arms. The only difference is the
Recipe text from `api/bazantic/recipe.md` ("Best eligible Hedera bond for a wallet"), given to arm B and withheld
from arm A. Both arms call the public API `https://wd6nrvmajt.ap-south-1.awsapprunner.com` and the public Hedera
Mirror Node directly (the Bazantic gateway `https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com` was still `draft`
and 404s until activated), so x402 spend is 0 in both arms.

| Item | Value |
|---|---|
| Prompt | "Wallet `<addr>` wants to buy a corporate bond on Hedera testnet. Using only the APIs you were given, recommend the single best bond it can actually hold, with yield and price, or say clearly if it cannot hold any. State every API call you made ... Do not guess values you did not fetch." |
| Arm A inputs | OpenAPI URL of the Bond Desk API + Mirror Node base URL |
| Arm B inputs | the same, plus the Recipe text |
| Model | one model for every run (the same coding agent, temperature default), two runs per wallet per arm |
| Wallet "nokyc" | `0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3`: Hedera account exists, no KYC. Truth: no bond it can hold; needs KYC. |
| Wallet "kyc" | `0x8524F940EddC9EA98198Ee08071944a07C417D7b`: KYC granted, holds 0 bonds. Truth: bond 1 (BDB27), Active, best ask 990000, yield 505 bps, coverage ~610 bps, a lifted FREEZE (nonce 2) in history. |
| Judge | an independent reviewer scored every transcript 0-5 on correctness, compliance-awareness, call efficiency and explanation, and checked for hallucinated values |

## Results

| Run | Correct | Eligibility checked | Calls | Wrong calls | Hallucination | Correctness | Compliance | Efficiency | Explanation |
|---|---|---|---|---|---|---|---|---|---|
| A-nokyc-run1 | yes | yes | 5 | 0 | no | 5 | 5 | 3 | 4 |
| A-nokyc-run2 | yes | yes | 8 | 0 | no | 4 | 5 | 2 | 4 |
| B-nokyc-run1 | yes | yes | 4 | 0 | no | 5 | 5 | 5 | 4 |
| B-nokyc-run2 | yes | yes | 5 | 0 | no | 5 | 5 | 4 | 5 |
| A-kyc-run1 | **no** | yes | 9 | 0 | no | 2 | 4 | 1 | 3 |
| A-kyc-run2 | **no** | yes | 6 | 0 | no | 2 | 4 | 3 | 2 |
| B-kyc-run1 (isolated re-run) | yes | yes | 6 | 0 | no | 5 | 5 | 4 | 5 |
| B-kyc-run2 | yes | yes | 6 | 0 | no | 5 | 5 | 4 | 5 |

| Arm | Correct | Mean calls | Correctness | Compliance | Efficiency | Explanation |
|---|---|---|---|---|---|---|
| A (raw OpenAPI) | 2 / 4 | 7.0 | 3.25 | 4.5 | 2.25 | 3.25 |
| B (Recipe) | 4 / 4 | 5.25 | 5.0 | 5.0 | 4.25 | 4.75 |

What the transcripts show:

- **nokyc wallet.** Both arms reached the right terminal answer, but arm A kept fetching the risk, order book and
  bond detail after eligibility had already failed (5 and 8 calls), and one A run added a misleading caveat that
  the historical FREEZE "must be resolved" although the bond is Active. Arm B stopped at the Recipe's empty
  `canHold` condition (4 and 5 calls) and told the user what to do next (get KYC from the issuer).
- **kyc wallet.** Arm A fetched every correct number (canHold true, ask 990000, yield 505, coverage 610) and then,
  in both runs, refused to recommend the bond because `lastVerdict.action` was FREEZE, ignoring `status: Active`.
  Consistent, and consistently wrong. Arm B recommended BDB27 in both runs and disclosed the lifted freeze at nonce
  2, exactly as Recipe step 5 instructs.
- No run in either arm hit a 4xx/5xx or fabricated a value.

## One harness fault, kept for honesty

The first B-kyc-run1 (`B-kyc-run1-shared-scratch.md`) concluded "cannot hold" from an eligibility payload that
belonged to the other wallet. Cause: the eight runs executed in parallel and shared one scratch directory with
identical file names, so that run read an `eligibility.json` written seconds earlier by a nokyc run. The API was
re-queried afterwards for both wallets back to back, with and without `?bondId`, and returned the right record
each time. The run was repeated alone in its own directory (`B-kyc-run1.md`) and is the row scored above. The
Recipe gained a step from this: check that the response `address` matches the wallet you asked about before
concluding.

## Reproduce

Give the same prompt to the same model twice with the inputs above, from a fresh session each time, and save the
transcript with the Calls list and the Answer paragraph. Score with the rubric in `api/bazantic/ab-test.md`.
To run through the gateway instead of the API, set `BOND_DESK` to the gateway endpoint once it is active and pay
with `baz curl`; the Recipe's five calls cost 25000 USDC base units per run at the suggested prices.

## Artifacts

| File | Arm | Wallet | Note |
|---|---|---|---|
| `A-nokyc-run1.md`, `A-nokyc-run2.md` | A | nokyc | |
| `B-nokyc-run1.md`, `B-nokyc-run2.md` | B | nokyc | |
| `A-kyc-run1.md`, `A-kyc-run2.md` | A | kyc | both refuse an eligible bond |
| `B-kyc-run1.md` | B | kyc | isolated re-run (scored) |
| `B-kyc-run1-shared-scratch.md` | B | kyc | harness fault, not scored |
| `B-kyc-run2.md` | B | kyc | |
