# Bazantic A/B — does the Recipe change what the agent does?

**Status: not yet run; results will be appended by a later commit.** The protocol below is fixed and the API it
needs is live at `https://wd6nrvmajt.ap-south-1.awsapprunner.com`. Both arms call that public API directly, plus
the public Hedera Mirror Node — not the Bazantic gateway, which is registered as
`https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com` but still `draft` and therefore 404s until it is priced and
activated in the dashboard (`api/bazantic/gateway.md`). Calling direct costs no x402, so the spend rows below
are `0` in both arms. None of the artifact files listed below have been produced yet; this README is the
protocol and the scoring sheet, not a result.

Raw transcripts from the A/B test defined in `api/bazantic/ab-test.md`. Six runs, identical prompt and identical
tools; **the only difference is the Recipe text from `api/bazantic/recipe.md`** — *"Best eligible Hedera bond for
a wallet"* — given to arm B and withheld from arm A.

The claim under test is narrow and falsifiable: **without the Recipe an agent recommends a bond the wallet
cannot legally buy.** These files are the evidence for or against it.

The inputs are the deployed bond and the real wallets from `deployments/testnet.json`:

| Input | Value |
|---|---|
| Bond | `bondId` 1, ATS token `0x0100526434C821d0df24f6CC60352F830F8b4504` |
| Eligible wallet | `0x897f8b6F2876d61E661889b578F4435E406baFdf` (KYC granted, holds 10 bonds) |
| Ineligible wallet | `0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3` (no KYC, `/eligibility` answers `canHold: false, reason: "no-kyc"`) |

Bond status is one of `None | Active | Frozen | Matured | Defaulted` and the last verdict action is one of
`OK | WARN | FREEZE | DEFAULT`, so a transcript that reports a numeric status or action has decoded the API
response wrong.

## Artifacts

| File | What it is |
|---|---|
| `expected.md` | The hand-computed correct answer, produced **before** any run, from `GET /wallets/{addr}/eligibility`, `GET /bonds` and `GET /bonds/{id}/risk`. Everything is scored against this, not against intuition. |
| `chain-state-before.json`, `chain-state-after.json` | Bond id, status, `bestAsk` and `coverageBps` captured either side of the six runs. They must be identical — if they are not, the arms saw different worlds and the comparison is void. |
| `A-run1.md` … `A-run3.md` | Control arm: Bond Desk OpenAPI + Hedera Mirror Node, called directly, no Recipe. Full transcript, every tool call with its arguments. |
| `B-run1.md` … `B-run3.md` | Recipe arm: identical tools, plus the Recipe text. |
| `recording-A.mp4`, `recording-B.mp4` | One screen recording per arm, back-to-back. The side-by-side is the demo-video segment. |

Each transcript opens with the filled-in recording template from `api/bazantic/ab-test.md` (arm, run number,
model, temperature, recommended bond, call counts, wasted calls, x402 spend, wall-clock, hallucinations) and
then the raw session.

## Results

_Filled in after the runs._

| Dimension (0–5) | Arm A mean | Arm B mean | Delta |
|---|---|---|---|
| Correctness | | | |
| Compliance awareness | | | |
| Efficiency | | | |
| Explanation | | | |
| Repeatability | | | |
| **Total** | | | |

| Metric | Arm A | Arm B |
|---|---|---|
| Correct bond recommended (of 3 runs) | | |
| Eligibility checked before recommending (of 3) | | |
| Mean tool calls | | |
| Mean wasted calls | | |
| Mean x402 spend (USDC base units) | | |

One paragraph of interpretation goes here, including **any failure that survived into arm B**. A Recipe that
fixes four of five failure modes is a stronger, more credible result than a claim that it fixed everything.

## Reproduce

Full protocol in `api/bazantic/ab-test.md`. In short: pin the chain state, run three fresh A sessions and three
fresh B sessions back-to-back at temperature 0 with the same model, change nothing on-chain in between, and
confirm the state diff is empty at the end.

```sh
diff docs/bazantic-ab/chain-state-before.json docs/bazantic-ab/chain-state-after.json   # must print nothing
```

## Before committing a transcript

Transcripts contain live tool calls, so check them the same way we check the CRE logs:

```sh
grep -riE 'private[_-]?key|0x[0-9a-fA-F]{64}|bearer |authorization:|baz_[A-Za-z0-9]{16,}' docs/bazantic-ab/ \
  && echo "REVIEW THE MATCHES ABOVE" || echo "clean"
```

Wallet **addresses** are public and belong in the transcripts — they are the input to the test. Session tokens,
`baz` credentials and any 64-hex string that could be a key do not. If the check matches, remove the whole run
and re-record it rather than editing the transcript; an edited transcript is not evidence.
