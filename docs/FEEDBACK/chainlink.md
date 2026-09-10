# Feedback — Chainlink CRE

Written while building two confidential workflows on `@chainlink/cre-sdk@1.20.0` / `cre` CLI 1.33.0, Sept 2026,
and revised after simulating both against live chains on 2026-09-10: `bond-monitor` (reads Hedera, signs an
EIP-712 risk verdict inside the TEE) and `liquidation-protection` (the Sepolia challenge). Findings were hit for
real unless marked **[to confirm]**. Deploy access was requested on 2026-09-10 and is not enabled yet, so
nothing here is observed from a deployed workflow.

## There is no enclave signing primitive, and that is the gap

The confidential workflow's whole value proposition is "this decision was made inside an enclave, with inputs
nobody else can see". But the only way to produce a verifiable artifact of that decision is to put a private key
in a secret and call viem's `privateKeyToAccount(secret)` inside the handler — which is the documented pattern,
including in Chainlink's own liquidation reference. That means the signature proves *the key was used*, not
*that a genuine enclave used it*. Anyone who obtains the secret produces identical, indistinguishable output.

For our design — Hedera can only be reached by relaying a signed verdict — this is the single load-bearing
weakness, and it is the one thing we cannot fix from user code. What would fix it:

- `runtime.signer()` or equivalent: an enclave-held key, non-extractable, whose public key is published per
  workflow, so an on-chain verifier can check "signed by the enclave running workflow X" rather than "signed by
  whoever holds this key".
- Failing that, a way to bind an attestation quote to a payload, so the verdict can carry `sign(payload)` plus
  evidence the signer ran in a TEE.

Today `usingTheDons().report()` is the closest thing to attestation, but it attests to a DON round, not to the
enclave that produced the payload, and there is no consumer for it on an unsupported chain. Documenting the
current guarantee honestly — "secrets are confidential; signatures are not enclave-attested" — would at least
stop teams overclaiming it in submissions.

## Five HTTP calls per execution, and no EVM client for `TeeRuntime`

`EVMClient` has no `TeeRuntime` overload, so **all** chain I/O from inside a TEE is raw JSON-RPC through
`HTTPClient.sendRequest`. Combined with the 5-calls-per-execution quota, a workflow that wants to read five
values and send a transaction is over budget before it starts.

The fix that works, and that should be in the docs as the canonical pattern: **batch the JSON-RPC**. One HTTP
request carrying an array of eight `eth_call` / `eth_getTransactionCount` / `eth_gasPrice` entries is one call
against the quota. Our liquidation workflow reads a position, a health factor, a price, two balances, two nonces
and a gas price in a single HTTP call, then sends one or two transactions in a second. Nobody should have to
discover that independently.

Two things the docs should state explicitly:

1. Whether a batched JSON-RPC request counts as one call. We assumed yes and designed to it; a 9-sub-call batch
   runs fine in the simulator, but the simulator shows per-call limits and not a running count, so this is still
   unconfirmed (see the list at the end).
2. That some public RPC endpoints reject batch bodies, so a workflow needs a documented non-batch fallback path.
   We designed one (five sequential calls, dropping the optional reads) rather than finding out at runtime.

Related quota notes worth putting on one page instead of scattered across the reference: 100 KB response cap,
10 s timeout, **no redirects** (a `3xx` from an RPC provider is an outage, not a retry), 30 s minimum cron, 5 min
execution timeout, and a maximum of 5 secret calls per execution — which forces you to batch `getSecrets` into a
single call with all ids, another thing worth an example.

## Unsupported chains deserve a documented pattern, not silence

Hedera is not a CRE-supported chain: no chain writer, no EVM client target, no report consumer. For us that was
not a blocker — the enclave reads Hedera over HTTP JSON-RPC and signs a verdict that any unprivileged relayer
can land on-chain, with replay closed by a nonce read from the same snapshot the decision used. It works, it is
cheap, and the relayer key carries no authority.

But we had to invent it. "Sign in the TEE, relay anywhere" is a *general* answer to "CRE does not support my
chain", and publishing it as a supported architecture — with the nonce/freshness/verifier contract sketch —
would meaningfully expand what people build on CRE without any change to the platform. Right now the
unsupported-chain story reads as "you cannot", when the truthful version is "you can, and here is the shape".

## `cre login` is required for `cre workflow simulate`

The simulator needs a browser login **and** a `CRE_ETH_PRIVATE_KEY` in `.env` merely to boot, even for a
workflow whose simulation touches neither. This blocks offline development, blocks CI, and blocks anyone
building on a machine that is not the machine they authenticate on — for us it meant the first day produced code
we could type-check and unit-test but not run. An offline/anonymous `simulate` mode, or a documented CI token,
would remove a real barrier for hackathon teams especially, where the login owner and the person at the keyboard
are often not the same person.

Adjacent: it is not obvious that the private key is only a boot requirement rather than something the simulator
will spend from. Say so in the error message.

## The challenge contract rejects every action outside a scoring scenario, and the brief does not say so

This is the single most expensive thing we learned, and it is one sentence of documentation.

`ChallengeLending`'s `repay` and `deposit` are behind an `onlyActive` modifier that only opens while Chainlink is
running one of its scoring scenarios. Outside a scenario they revert with `Scenario has not started`. The brief
and the template describe the position, the health factor and the actions, and say nothing about the gate, so
the obvious first version of a workflow does exactly what ours did: reads a health factor of 1.11 right after
`join()`, correctly decides to defend, signs a `repay` inside the enclave, broadcasts it, and watches it revert
on-chain having spent the gas
([`0xf3e806bc…dc7effe8`](https://sepolia.etherscan.io/tx/0xf3e806bce55bc2ed87bd7bc3d9b7b3bbd604a4b1b4dc6f7514ace408dc7effe8),
log: `docs/cre-evidence/liquidation-protection-20260910-1426-defend-reverted.log`).

That matters more than a wasted transaction, because "intervention discipline" is 10% of the score. A workflow
on a 30-second cron that defends whenever the health factor is low will burn a reverting transaction every 30
seconds for days before the scenarios start, and every one of those is a discipline failure caused by missing
documentation rather than by a bad policy.

The fix on our side is a ninth sub-call in the read batch: an `eth_call` that simulates `repay(1)` from the
wallet. If it reverts with a "not started" style message, the workflow logs `plan=scenario-inactive` and returns
without signing anything (`docs/cre-evidence/liquidation-protection-20260910-1433-inactive.log`). It costs
nothing, because it rides in a batch that was already going out.

Three asks, in order of value:

1. State the gate in the challenge brief: which functions are gated, what the revert string is, and when the
   scenarios run.
2. Ship the probe, or a `scenarioActive()` view, so teams do not have to discover a gate by simulating a
   transaction against it. A public boolean is a better interface than a revert string that a workflow has to
   pattern-match on.
3. Say in the brief that a reverted intervention counts against discipline, if it does. Teams are currently
   guessing at what the scoring sees.

## The liquidation challenge template ships details that do not match the deployed contracts

Two more concrete traps, both silent:

- `config.staging.json` in the template carries **stale addresses**. The live ones are `ChallengeLending
  0x88574e7Cc0027afd04951daa09B64d4441931ba1`, vETH `0x5dED1a40c3D56dA42E7f932f781c0432556c9814`, vUSD
  `0x6Fe92Ead5299040f50F095860b5A0A7A2D4041A2`. A workflow pointed at the stale set runs, decodes, and decides
  about nothing.
- The template's `getUserPosition` ABI has **five** fields; the deployed contract returns **six**
  (`collateral, debt, hf, numOperations, lastUpdateTime, cumulativeDebtTime`). ABI decoding with the short tuple
  does not throw — it silently misaligns, and you get a plausible-looking wrong health factor. We only caught it
  by reading the verified source.

A hackathon template is the highest-leverage documentation you ship. Regenerating its ABIs and addresses from
the deployed contracts as part of the release, or having the workflow assert `vETHPrice()` against a known value
on first run, would prevent both. Also worth stating in the challenge brief: vUSD has **2 decimals**, which
makes every hand-checked number in a health-factor calculation wrong by 10¹⁶ if you assume 18, or by 10⁴ if you
assume 6 like USDC.

## `zod`'s `.url()` does not work in the workflow runtime

Config validation is the first code a workflow runs and the most obvious place to use `z.string().url()` for an
RPC endpoint. In the QuickJS/WASM runtime that check fails on a perfectly valid URL: the workflow refuses to
start with `Invalid url` and there is nothing wrong with the config. The fix is trivial once you know, and we
now use it in both workflows:

```ts
// hederaRpcUrl: z.string().url(),          // fails in the runtime with "Invalid url"
hederaRpcUrl: z.string().startsWith("https://"),
```

The reason (zod's URL validation reaching for a platform API the runtime does not provide) is invisible from the
error message, and the failure mode is the worst kind: a validator that rejects valid input, in the one place a
developer will not suspect. This belongs in the runtime support matrix asked for below, and ideally in the
starter template's config schema so nobody writes `.url()` in the first place.

## The CLI warns when a secret id equals its env var name

`secrets.yaml` maps a secret id to the environment variables that hold its value, so the id and the variable
name are different things. If they happen to be spelled the same, the CLI emits a warning. That is a reasonable
guard, but the warning reads as an error on first encounter and the fix is not obvious from the text. We renamed
every environment variable with a `CRE_` prefix (`VERDICT_SIGNER_KEY` ← `CRE_VERDICT_SIGNER_KEY`) which is
probably the intended convention. Saying so in the `secrets.yaml` reference, with one example of the two names
side by side, would turn a warning into a non-event.

## SDK 1.20 migration papercuts

- `headers` is deprecated in favour of `multiHeaders` (`{ "Content-Type": { values: ["application/json"] } }`),
  with little signposting. The deprecated form appears to work and then does not set the header.
- `body` on `sendRequest` must be **base64**. Passing a JSON string produces an unhelpful upstream error rather
  than a validation failure at the call site.
- The runtime is QuickJS/WASM: no `node:crypto`, no `Date.now()` or `Math.random()` for determinism (use
  `runtime.now()`), while noble and viem work fine. A short "what is available in the workflow runtime" support
  matrix — crypto, timers, fetch, Buffer, TextDecoder — would save every team the same afternoon of trial and
  error.

## Deploy access is a hard gate on a 9-day hackathon

`cre workflow simulate` runs without deploy access; `cre workflow deploy` does not, and the liquidation
challenge is scored on a **deployed** workflow. So the whole submission depends on an access request with a
documented ~24 h turnaround, and the simulator's closing banner (`Run cre account access to request deployment
access.`) is the first place many teams will learn that. We submitted the form on 2026-09-10 and the workflows
in this repo are therefore simulated only.

The fix is scheduling, not engineering: put "request deploy access now, it takes about a day" in the first
paragraph of the challenge brief, not in the docs. A hackathon team that reads the brief on day 7 has already
lost. An auto-approved staging tier with tight quotas would be better still, since staging is where every
hackathon workflow lives anyway.

## **[to confirm]**

- `cre secrets create secrets.yaml --target staging-settings --secrets-auth=browser`, and whether secret
  rotation requires a redeploy. Written up in `workflow/README.md` from the reference, not yet run.
- Whether a batched JSON-RPC request counts as one call against the 5-per-execution quota. Our workflows are
  designed to it, and a 9-sub-call batch executed fine in the simulator with no quota complaint, but the
  simulator prints per-call limits rather than a running count, so we cannot prove the accounting. If a batch is
  counted per sub-call, a lot of workflows are silently near the limit.
- Whether production TEE logs are retrievable at all. We assume they are invisible by design and are treating
  simulator output as the only evidence artifact (`docs/cre-evidence/README.md`). If there is *any* production
  observability, say where; if there is none, say that too, because teams are currently guessing.

## What worked well

The simulator's TEE banner and `[USER LOG]` lines are exactly the right evidence artifact: readable,
copy-pasteable, and unambiguous about what is and is not a real enclave. `handlerInTee` plus `getSecrets` is a
genuinely small API for something this powerful: our whole confidential policy is one 58-line pure module
(`workflow/shared/decide.ts`) that both workflows import and that a reviewer can audit in a minute. That is a
good design, and it is why the "private thresholds, public verdict" property was cheap to build. The other
thing worth keeping is that a threshold living in a secret makes the confidentiality claim testable: two
simulator runs against the same config hash, differing only in what the chain said, produced two different
verdicts and neither log contains a threshold.
