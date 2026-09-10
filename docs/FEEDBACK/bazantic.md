# Feedback — Bazantic

Written while agentifying the Bond Desk API (`@bazantic/cli`, gateway + Recipe, x402/USDC on Base), Sept 2026.
Most of this project's Bazantic work is registration and authoring rather than code, so items are marked by
provenance: **[observed]** = hit while building; **[to confirm]** = designed around, not yet exercised.

State at the time of writing: signed in as **Abhimanyu** with scopes `gateway:read, gateway:write, recipe:read,
recipe:write`. The gateway itself is not registered yet, because Bazantic pins the endpoint URL at registration
and the Bond Desk API does not have a stable public HTTPS origin yet. Everything about the registration is
scripted in `api/bazantic/gateway.md` and blocked on that one thing.

## The device sign-in link expires in 15 minutes **[observed]**

`baz login` prints a `https://bazantic.com/cli/login?code=…` URL and waits. The code is good for 15 minutes,
which is short enough to matter in practice: the common case is a developer starting a login in a terminal,
switching to finish something else, and coming back to a dead link and a CLI still waiting. Two small fixes,
either of which is enough:

1. Print the expiry next to the URL ("this link expires in 15 minutes") so the deadline is visible at the
   moment it starts.
2. Have the CLI notice the expiry and offer to reissue the code in place, instead of waiting on a code that can
   no longer succeed.

What the flow gets right and should keep: the line `This device will be able to manage your gateways. It cannot
spend.` The scope of a device token is exactly the thing a developer wants to know before approving it, and
stating it in the terminal rather than only in a browser consent screen is better than most CLI login flows
manage. The session's granted scopes and expiry are then echoed on success, which is the right amount of
feedback.

## The docs are login-gated, including the Recipe format **[observed]**

You cannot read what a Recipe is, or what its schema looks like, without an account. That inverts the normal
order of work: a developer wants to design the agent flow first and register the API second, but here the
authoring format is invisible until after sign-up. We wrote our Recipe as prose against inferred structure
(`api/bazantic/recipe.md`) and expect to reshape it once we can see the real editor — which is wasted effort on
both sides.

The high-value fix is small: one public page containing (a) a one-paragraph definition of a Recipe, (b) an
annotated example, and (c) the field list. Everything else can stay behind the login. This also matters for
discoverability: a public example page is what gets linked, quoted and indexed.

There is a second half to this. Authoring a Recipe is **dashboard-only** even once you are signed in, and yet
the device token the CLI receives carries `recipe:read` and `recipe:write` scopes. So the permission model
already treats Recipes as a first-class CLI resource while the CLI has no `baz recipe` command to use it with.
A Recipe is text; it is the part of this integration most worth version-controlling, diffing and reviewing, and
right now it cannot be. `baz recipe create --file recipe.md` and `baz recipe get <id>` would make the whole
integration reproducible from a repository, and the scopes suggest that was the intention.

## Pricing is dashboard-only, so registration cannot be reproduced **[observed]**

`baz gateway add` takes `--spec-url`, `--endpoint`, `--name`, `--auth-type`, `--status`, but there is no way to
set per-operation prices from the CLI. That means the interesting half of a gateway's configuration — the half a
reviewer or a teammate would want to see — lives only in a dashboard and cannot be committed, diffed, code
reviewed, or restored. Our repo can document the prices (`api/bazantic/gateway.md`) but cannot *apply* them.

Two options, either of which solves it:

1. CLI flags or a config file: `baz gateway pricing set <id> --op listBonds --price 5000`, plus
   `baz gateway pricing list <id> --json` so the current state is inspectable.
2. Read prices from the OpenAPI document itself — an `x-bazantic-price` extension per operation. This is the
   better one: the price then lives next to the operation it prices, versioned with the API, and a redeploy of
   the spec updates the gateway. It also makes the whole registration a one-liner in CI.

A related gap: prices are USDC base units (6 decimals) and it is easy to be off by 10³ in a field that has no
unit label. Showing the USD equivalent live next to the input would prevent a class of expensive typo.

## The endpoint URL is fixed at registration **[to confirm]**

Change the endpoint and you must create a new gateway. For anyone demoing from a tunnel (`cloudflared` URLs
rotate on every restart) that means a fresh gateway, fresh pricing, and a fresh slug in every document and
recording that referenced the old one. We have not hit this directly, because it is precisely why we have not
registered yet: knowing the URL is pinned forced a hosting decision before the gateway could exist at all, and
that decision is the one thing still outstanding in this integration. A team that discovers the constraint on
demo day loses their gateway.

Allowing the endpoint to be edited (with a re-fetch of the spec, and a warning) would be a small change with a
large effect on the hackathon path specifically.

## Spec URL/Paste toggle: good in the dashboard, missing from the CLI **[observed]**

The dashboard's OpenAPI field has a URL/Paste toggle, which is genuinely thoughtful — it means the spec document
does not have to be hosted, only the API. But the CLI has only `--spec-url`, so the scriptable path is strictly
weaker than the manual one. `--spec-file ./openapi.json` would close the gap and, together with CLI pricing,
would make a gateway fully reproducible from a repo.

## Service discovery for Recipe authors **[to confirm during deployment]**

A Recipe's value comes from chaining services, so the first question an author asks is "what else is on this
platform, and what does it cost?". We knew to use Hedera Mirror Node because it came up in the prize
description, not because we could browse a catalogue. A public, browsable service directory — name, description,
operations, price range — would directly increase the number and quality of Recipes, which is the thing the
platform actually wants. We will note in the A/B write-up whether the in-dashboard catalogue already covers
this once we are logged in.

## MCP surface **[to confirm during deployment]**

We are checking three things at registration time and will record what we find
(`api/bazantic/gateway.md`, step 6):

- Whether `tools/list` returns our OpenAPI `operationId` values as tool names, or generated slugs. Tool naming
  is the single biggest lever on whether an agent picks the right call, so an operationId that survives into MCP
  is worth guaranteeing and documenting.
- Whether OpenAPI `description` and our `x-agent-hints` reach the MCP tool descriptions. If they do not, the
  work an API author puts into agent-facing descriptions is invisible in exactly the surface agents use.
- Whether the 402 challenge is machine-readable enough for an agent to decide "this call costs $0.01, my budget
  is $0.05, proceed" without human help. Priced tools whose price is only discoverable by *attempting* the call
  make budgeting hard; exposing the price in the tool description or in the MCP tool schema would fix it.

There is also a reported typo/broken link in the `llms.txt` MCP section that we will pin down and report
precisely once we can reach the live document — flagging it here so it does not get lost.

## What works well

x402 with USDC on Base is the right primitive for this. `baz curl --max-amount … --json --verbose` reads like a
good CLI from its surface (**[to confirm]** against a live gateway): printing the settlement line next to the
response body makes the payment legible in a way a hidden metering dashboard never would. Device-code
`baz login` avoids putting a key anywhere near the repo, and it states the token's scope before you approve it.
And the core idea, that an OpenAPI document plus a price is enough to make an API agent-payable with MCP for
free, is a genuinely small amount of work for what it produces: our whole integration is one hosted spec, one
`gateway add`, and six prices, and the only reason it is not done is the hosted spec.
