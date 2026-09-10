# Feedback — Bazantic

Written while agentifying the Bond Desk API (`@bazantic/cli`, gateway + Recipe, x402/USDC on Base), Sept 2026.
Most of this project's Bazantic work is registration and authoring rather than code, so items are marked by
provenance: **[observed]** = hit while building; **[to confirm]** = designed around, not yet exercised.

State at the time of writing: signed in as **Abhimanyu** with scopes `gateway:read, gateway:write, recipe:read,
recipe:write`. The gateway is registered — `baz gateway add` on 2026-09-10 11:40 UTC against the API's App
Runner URL, returning id `05e95747-b9a2-4cae-9c62-c0f291a3fcd3` and slug `axuvor5zujgk5hdcydzjdi742m` — and sits
in `draft`. What is left is pricing, activation and the Recipe, none of which the CLI can do; the full record is
in `api/bazantic/gateway.md`.

## Registration is genuinely one command **[observed]**

`baz gateway add --spec-url … --endpoint … --name … --auth-type x402-mpp --status draft --json` worked first
time and returned the whole record — `id`, `slug`, `endpointUrl`, `mcpUrl`, `category`, `status` — as JSON, with
`category` inferred (`data`) rather than demanded. Nothing had to be clicked to get an API onto the platform.
That is the strongest part of the product and the reason the gaps below are worth fixing: they are all in the
half-step *after* the good CLI experience.

## A draft gateway 404s instead of saying it is a draft **[observed]**

While `status` is `draft`, `GET <endpointUrl>/bonds` and `POST <endpointUrl>/mcp` both return
`404 page not found` from the edge (Fly). That is indistinguishable from a wrong slug, a wrong URL shape, or a
gateway that was never created, and it sent us checking all three before concluding the status was the cause.
A draft gateway is a known, named state on the platform's own side, so it should say so: `409` or `403` with
`{"error":"gateway is in draft; activate it in the dashboard"}` costs nothing and removes the whole debugging
detour. The same applies to an active-but-unpriced operation.

## The gateway URL shape is a subdomain, not a path **[observed]**

The real URL is `https://<slug>.bazgateway.com` (ours: `https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com`,
MCP at `/mcp` under it). The public skill/docs page reads as though gateways are served as
`https://bazgateway.com/<slug>`, so we wrote our first runbook and Recipe against the path form and had to fix
every occurrence. Both forms look equally plausible from outside, and the wrong one fails as a 404 — the same
404 a draft gateway returns, which compounds the previous item. Either the public page should show the
subdomain form, or `bazgateway.com/<slug>` should redirect to it.

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

## Pricing and activation are dashboard-only, so a gateway cannot be reproduced **[observed]**

`baz --help` lists exactly `login`, `logout`, `whoami`, `gateway add`, `gateway list`, `curl`, `wallet` and
`grant`. So `gateway add` can create a gateway but nothing can price it, activate it, or edit it afterwards —
there is no `gateway update`, no pricing command, and no `recipe` command at all. The interesting half of a
gateway's configuration, the half a reviewer or a teammate would want to see, lives only in a dashboard and
cannot be committed, diffed, code reviewed, or restored. Our repo can document the prices
(`api/bazantic/gateway.md`) but cannot *apply* them, and the one CLI-scriptable step deliberately ends in
`draft` because shipping an active gateway with unpriced operations would mean giving the API away.

Two options, either of which solves it:

1. CLI flags or a config file: `baz gateway pricing set <id> --op listBonds --price 5000`, plus
   `baz gateway pricing list <id> --json` so the current state is inspectable, and a
   `baz gateway activate <id>` so the last step of the lifecycle is scriptable too.
2. Read prices from the OpenAPI document itself — an `x-bazantic-price` extension per operation. This is the
   better one: the price then lives next to the operation it prices, versioned with the API, and a redeploy of
   the spec updates the gateway. It also makes the whole registration a one-liner in CI.

A related gap: prices are USDC base units (6 decimals) and it is easy to be off by 10³ in a field that has no
unit label. Showing the USD equivalent live next to the input would prevent a class of expensive typo.

## The endpoint URL is fixed at registration **[to confirm]**

Change the endpoint and you must create a new gateway — there is no `gateway update` to try. For anyone demoing
from a tunnel (`cloudflared` URLs rotate on every restart) that means a fresh gateway, fresh pricing, and a
fresh slug in every document and recording that referenced the old one. We did not hit it, because knowing the
URL was pinned forced the hosting decision *before* registration: the API went onto App Runner first and the
gateway was registered against that URL once. That is the right order, but it is only obvious to someone who
already knows the constraint. A team that discovers it on demo day loses their gateway.

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

## MCP surface **[to confirm after activation]**

The gateway has an `mcpUrl` (`https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com/mcp`) but it 404s while the
gateway is `draft`, so these three checks are blocked on the dashboard steps rather than on anything we control
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
`gateway add`, and six prices. The first two took minutes from the CLI; the six prices are the part that still
needs a browser.
