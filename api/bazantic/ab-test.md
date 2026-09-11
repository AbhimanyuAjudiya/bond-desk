# A/B test — does the Recipe beat the raw spec?

The claim the Bazantic prizes want evidence for is that a Recipe makes an agent measurably better at using the
APIs, not just prettier. This is the protocol as it was actually run on 2026-09-10; the results and transcripts are in
`docs/bazantic-ab/`.

## Tracks, and what the A/B is evidence for

- **Best Recipe that uses EthGlobal Hackathon Sponsor APIs** — the Recipe chains three services and each one is
  load-bearing ("show why each service matters"):
  - **Hedera Mirror Node (testnet)** — a sponsor's API, registered by us as
    `https://txrkgk2mezhbln4aeo2tdji6s4.bazgateway.com` because the pre-existing catalog entry is mainnet-only. It is
    the only source for "does this EVM address have a Hedera account", which is the first disqualifier, and for the
    wallet's own transaction history (`getTransactions`), which the answer quotes verbatim and which the Bond Desk
    API cannot return.
  - **Bond Desk API (Hedera)** — our gateway: per-wallet KYC eligibility, the live book, collateral coverage and the
    last enclave-signed risk verdict. The eligibility answer is the branch that decides whether anything is
    recommended at all.
  - **Bank of Canada Valet** — the service that was new to Bazantic: the sovereign benchmark curve. The Recipe ranks
    eligible bonds by spread over the benchmark for their remaining life and refuses to call a bond a buy when it does
    not clear it. Without it the Recipe can say "allowed", not "worth it".
- **Agentify a new API** — **Bank of Canada Valet** (`https://4q4fqndwcnhxrfk6thlgjnodca.bazgateway.com`): not on
  Bazantic before 2026-09-11 (eligibility check in `gateway.md`, step 6c), not a sponsor API, keyless, bound into the
  same Recipe next to our own gateway.
- Not entered: *Help an Agent Use Your Hackathon Project* is a Continuity-Track prize and this is a from-scratch
  project.

The A/B below was run on 2026-09-10 against the two-service version of the Recipe (mirror node + Bond Desk). The
logic it tests — check the account, gate on eligibility, gate on current status rather than on a historical verdict —
is unchanged in the three-service version; the benchmark step and the transaction-history step were added afterwards
and are exercised by the dashboard test runs in `recipe.md`, not by this A/B.

## Protocol — what actually ran

Two arms, identical in everything except what the agent is given up front. **The only difference between the arms is
the Recipe text from `api/bazantic/recipe.md` (as it stood on 2026-09-10), supplied to arm B as context.** Arm B did
not call the published Recipe tool; the point was to isolate the effect of the Recipe's instructions on the same raw
tools.

Both arms call the public API directly at `https://wd6nrvmajt.ap-south-1.awsapprunner.com`, plus the public Hedera
testnet mirror node — not the Bazantic gateway. That is by design: direct calls keep both arms free of x402
settlement, so the spend row is `0` in both and the comparison is about agent behaviour rather than cost. The gateway
is live (`gateway.md`); point `BOND_DESK` at `https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com` and pay with
`baz curl` for a priced transcript — same endpoints, same paths, same responses.

| | Arm A (control) | Arm B (Recipe) |
|---|---|---|
| Tools | Bond Desk OpenAPI URL + Hedera Mirror Node base URL, called directly | the same, unchanged |
| Extra context | none | the Recipe text from `api/bazantic/recipe.md` |
| Prompt | identical | identical |
| Agent | the same LLM agent with tool use for every run (identical system prompt, tools and default temperature); the model identifier is recorded in the submission form | same |
| Session | fresh session per run, no memory carried between runs | same |
| Wallets | `kyc` (`0x8524F940EddC9EA98198Ee08071944a07C417D7b`) and `nokyc` (`0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3`) | same |
| Runs | 2 per wallet (4) | 2 per wallet (4), plus one isolated re-run of a run hit by a harness fault |

The shared prompt, used verbatim in every run (`docs/bazantic-ab/README.md` quotes it in full):

> Wallet `<addr>` wants to buy a corporate bond on Hedera testnet. Using only the APIs you were given, recommend the
> single best bond it can actually hold, with yield and price, or say clearly if it cannot hold any. State every API
> call you made … Do not guess values you did not fetch.

Chain state was held constant by not deploying, filling, freezing or unfreezing anything between the first and the
last run; the truth for each wallet was derived once, by hand, from the same endpoints before the runs and is the
"Truth" column of the Setup table in `docs/bazantic-ab/README.md` (no separate expected-answer file exists).

Transcripts are one file per run, `docs/bazantic-ab/<arm>-<wallet>-run<n>.md`, each with the full call list (tool,
arguments, result) and the final answer.

## Recording template

Each transcript's header carries this table.

| Field | Value |
|---|---|
| Arm | A / B |
| Wallet, run # | |
| Date | |
| Recommended bond (id, symbol) | |
| Correct? (matches the hand-derived truth) | yes / no |
| Eligibility checked before recommending? | yes / no |
| Mirror-node account check performed? | yes / no |
| Risk / freeze check performed? | yes / no |
| Tool calls, total | |
| Tool calls, wasted (repeated, wrong endpoint, wrong arguments) | |
| x402 spend, USDC base units (`0` in both arms — direct API calls by design) | |
| Hallucinated fields or numbers (list them) | |
| Exclusions explained in the answer? | none / partial / all |

## Scoring rubric

Four dimensions, 0–5 each, scored per run by a reviewer who did not run the sessions; report per-arm means and the
delta B − A. Repeatability is read off the pair of runs per wallet rather than scored as a fifth column.

| Dimension | 0 | 3 | 5 |
|---|---|---|---|
| **Correctness** | Names a bond the wallet cannot hold, refuses one it can, or invents one | Names the right bond but misstates a number | Names the right bond with yield, ask and coverage all matching the truth |
| **Compliance awareness** | Never checks KYC or the Hedera account | Checks eligibility but does not explain the exclusions | Checks the account, checks KYC, and names every excluded bond with its reason |
| **Efficiency** | More than 10 calls, or repeats the same call | 6–10 calls, some waste | ≤ 6 calls, no repeats, no wrong-argument retries |
| **Explanation** | Bare answer, no reasoning | Reasoning present, numbers unsourced | Every number traceable to an endpoint, HashScan link included |

A result worth reporting is a delta, not a total. If B does not beat A on **correctness** and **compliance
awareness**, the Recipe is not earning its place and should be rewritten before submission — say so in the write-up
rather than burying it.

## What was published

- The nine transcripts (eight scored, one harness-fault run kept for honesty) in `docs/bazantic-ab/`.
- The per-run and per-arm tables, and the one harness fault, in `docs/bazantic-ab/README.md`.
- The failure that survived in arm B, quoted there: none in the scored runs; the fault was in the harness (a shared
  scratch directory), and it produced a new Recipe step (check the `address` in the eligibility response).
