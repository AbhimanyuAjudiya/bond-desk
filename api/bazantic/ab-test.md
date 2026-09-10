# A/B test — does the Recipe beat the raw spec?

The claim the Bazantic prizes want evidence for is that a Recipe makes an agent measurably better at using the
APIs, not just prettier. This is the protocol that produces that evidence.

## Tracks entered, and why

- **Best Recipe using sponsor APIs** — the Recipe chains **Hedera Mirror Node** (already a Bazantic service,
  i.e. the sponsor API) with our own gateway. The mirror node is load-bearing, not decoration: it is the only
  source for "does this EVM address have a Hedera account and enough HBAR for gas", which is the first
  disqualifier in the flow.
- **Agentify a new API** — the **Bond Desk API** is new and is not a sponsor API. It exposes on-chain state that
  has no public endpoint anywhere: the ATS compliance verdict per wallet, the order book rebuilt from contract
  storage, and the last risk verdict signed inside a Chainlink CRE enclave.

Both submissions point at the same gateway and the same recording; the A/B run is the shared evidence.

## Protocol

Two arms, identical in everything except what the agent is given up front. **The only difference between the
arms is the Recipe text from `api/bazantic/recipe.md`.**

Both arms call the public API directly at `https://wd6nrvmajt.ap-south-1.awsapprunner.com`, plus the public
Hedera Mirror Node — not the Bazantic gateway, which is registered but still `draft` and therefore 404s
(`gateway.md`). Same endpoints, same paths, same responses as the gateway will proxy; what direct calls do not
produce is an x402 settlement, so the spend row of the template is `0` in both arms and the comparison is about
agent behaviour rather than cost. Re-run through the gateway once it is active if a priced transcript is wanted.

| | Arm A (control) | Arm B (Recipe) |
|---|---|---|
| Tools | Bond Desk OpenAPI + Hedera Mirror Node spec, called directly | Same tools, unchanged |
| Extra context | none | the Recipe text from `api/bazantic/recipe.md` |
| Prompt | identical | identical |
| Model, temperature | same model, temperature 0 | same model, temperature 0 |
| Session | fresh session per run, no memory carried between runs | same |
| Runs | 3 | 3 |

The shared prompt, used verbatim in all six runs:

> Wallet `0x<INVESTOR1>` wants to buy a corporate bond on Hedera testnet. Which bond should it buy, and can it
> actually buy it? Use the tools available to you. Give the yield, the current ask, the collateral coverage, and
> anything that disqualifies the other bonds.

Run the six sessions back-to-back against the same chain state — do not deploy, fill, or freeze anything between
run 1 and run 6, or the arms are not comparable. Pin the chain state first:

```sh
export PUBLIC_URL=https://wd6nrvmajt.ap-south-1.awsapprunner.com
curl -s "$PUBLIC_URL/bonds" | jq -c '[.bonds[] | {id, status, bestAsk, coverageBps}]' \
  > docs/bazantic-ab/chain-state-before.json
# … six runs …
curl -s "$PUBLIC_URL/bonds" | jq -c '[.bonds[] | {id, status, bestAsk, coverageBps}]' \
  > docs/bazantic-ab/chain-state-after.json
diff docs/bazantic-ab/chain-state-before.json docs/bazantic-ab/chain-state-after.json   # must be empty
```

Transcripts go to `docs/bazantic-ab/A-run1.md` … `A-run3.md`, `B-run1.md` … `B-run3.md`, one file per run,
full transcript including every tool call and its arguments. Screen-record one A run and one B run
back-to-back — that side-by-side is the segment in the demo video.

## Recording template

Copy this table into each transcript's header and fill it from the run.

| Field | Value |
|---|---|
| Arm | A / B |
| Run # | |
| Date, model, temperature | |
| Recommended bond (id, symbol) | |
| Correct? (matches the hand-computed answer) | yes / no |
| Eligibility checked before recommending? | yes / no |
| Mirror-node account check performed? | yes / no |
| Risk / freeze check performed? | yes / no |
| Tool calls, total | |
| Tool calls, wasted (repeated, wrong endpoint, wrong arguments) | |
| x402 spend, USDC base units (`0` while both arms call the API directly) | |
| Wall-clock time to final answer | |
| Hallucinated fields or numbers (list them) | |
| Exclusions explained in the answer? | none / partial / all |

The hand-computed answer is produced once, before the runs, from the same three endpoints, and stored as
`docs/bazantic-ab/expected.md`. Score against that, not against intuition.

## Scoring rubric

Five dimensions, 0–5 each, scored per run; report the mean of the three runs per arm and the per-dimension
delta B − A.

| Dimension | 0 | 3 | 5 |
|---|---|---|---|
| **Correctness** | Names a bond the wallet cannot hold, or invents one | Names the right bond but misstates a number | Names the right bond with yield, ask and coverage all matching `expected.md` |
| **Compliance awareness** | Never checks KYC or the Hedera account | Checks eligibility but does not explain the exclusions | Checks the account, checks KYC, and names every excluded bond with its reason |
| **Efficiency** | More than 10 calls, or repeats the same call | 6–10 calls, some waste | ≤ 6 calls, no repeats, no wrong-argument retries |
| **Explanation** | Bare answer, no reasoning | Reasoning present, numbers unsourced | Every number traceable to an endpoint, HashScan link included |
| **Repeatability** | The three runs disagree on the recommended bond | Same bond, materially different reasoning or call counts | Same bond, same call sequence, same numbers across all three runs |

A result worth reporting is a delta, not a total. If B does not beat A on **compliance awareness** and
**repeatability**, the Recipe is not earning its place and should be rewritten before submission — say so in the
write-up rather than burying it.

## What to publish

- The six transcripts and `expected.md` in `docs/bazantic-ab/`.
- One table of per-arm means and deltas, in `docs/bazantic-ab/README.md`.
- The two screen recordings.
- Any failure that survived in arm B, quoted. A Recipe that fixes four of five failure modes is a stronger
  result than a claim that it fixed all five.
