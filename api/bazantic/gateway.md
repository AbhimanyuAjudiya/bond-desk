# Bazantic gateway — registration runbook

Registers the **Bond Desk API** as a paid, agent-callable service on Bazantic, plus the two other gateways the Recipe
chains it with: the **Hedera testnet mirror node** (step 6b) and the **Bank of Canada Valet** benchmark-yield API
(step 6c, the service that was on neither Bazantic nor a sponsor's list). Every step below has been run:
the gateway is **active (LIVE)** at `https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com` and published to the
marketplace, pending Bazantic's listing verification. Checks 4 and 6 were verified on 2026-09-11.

The endpoint URL is **fixed at registration**, so it was registered against the API's permanent host: AWS App
Runner in `ap-south-1`, serving `https://wd6nrvmajt.ap-south-1.awsapprunner.com` (see `api/README.md`).

## 0. Prerequisites

```sh
npm i -g @bazantic/cli
baz login          # device sign-in, approved in a browser
baz whoami         # Abhimanyu — the account username the Bazantic prize submission asks for
baz wallet         # USDC funding address (Base; base-sepolia for testnet)
```

```sh
export PUBLIC_URL=https://wd6nrvmajt.ap-south-1.awsapprunner.com
export INVESTOR1=$(jq -r .wallets.investorKyc1 deployments/testnet.json)   # a real 0x… address; the API 400s on anything else
curl -sf "$PUBLIC_URL/healthz" | jq .            # {"ok":true,"chainId":296,"block":…}
curl -sf "$PUBLIC_URL/openapi.json" | jq -r '.info.title, (.paths | keys[])'
```

Both must succeed **before** registering — Bazantic fetches the spec at registration time. Verified on
2026-09-10: `/healthz` returns `{"ok":true,"chainId":296,…}`, and `/openapi.json` is OpenAPI 3.1 with
`servers[0].url` equal to `$PUBLIC_URL` and the six operations priced below. (The API has since grown to ten operations, `/openapi.json` on the live URL; the gateway was registered from this six-operation spec and still exposes exactly those six. The four newer ones, verdict history, the activity feed and the testnet KYC desk, are deliberately outside the paid surface: the KYC desk in particular must stay a same-origin call from the app, not a marketplace tool.)

## 1. Register the gateway — done

Run from the CLI on **2026-09-10 11:40 UTC**:

```sh
baz gateway add \
  --spec-url "$PUBLIC_URL/openapi.json" \
  --endpoint "$PUBLIC_URL" \
  --name "Bond Desk API (Hedera)" \
  --auth-type x402-mpp \
  --status draft \
  --json
```

`--status draft` is deliberate: prices are set after registration, and a live gateway with unpriced operations
is a free API. The returned record:

| Field | Value |
|---|---|
| `id` | `05e95747-b9a2-4cae-9c62-c0f291a3fcd3` |
| `slug` | `axuvor5zujgk5hdcydzjdi742m` |
| `endpointUrl` | `https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com` |
| `mcpUrl` | `https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com/mcp` |
| `category` | `data` |
| `status` | `draft` at registration, `active` since 2026-09-11 |

The gateway URL is a **subdomain per slug** — `https://<slug>.bazgateway.com` — not a path under
`bazgateway.com`. Export it once and use it for every call below:

```sh
export SLUG=axuvor5zujgk5hdcydzjdi742m
export GATEWAY="https://$SLUG.bazgateway.com"
baz gateway list --json | jq '.listings[] | {id, name, slug, endpointUrl, status}'   # the JSON is {ok, listings:[…]}, not a bare array
```

While the gateway was `draft` it routed nothing: `GET $GATEWAY/bonds` and `POST $GATEWAY/mcp` both answered
`404 page not found` from Fly's edge rather than a 402 challenge. Activation (step 3) is what turns the routes
on.

Dashboard note: the gateway form's OpenAPI field has a **URL / Paste toggle**, so the spec document itself need
not be hosted — but the API endpoint must be. We used the URL side (`$PUBLIC_URL/openapi.json`) so the gateway
re-reads the spec this repo ships (`api/src/openapi.ts`) instead of a pasted copy that drifts.

## 2. Price every operation — done

Dashboard → the gateway → per-method pricing. Prices are in **millicents**: `1000` mcents = $0.01. (Not USDC
base units — the field carries no unit label, so this is worth checking against the USD figure the dashboard
shows.) There is no CLI path for pricing: `baz --help` lists `login`, `logout`, `whoami`, `gateway add|list`,
`curl`, `wallet` and `grant`, and nothing else (see `docs/FEEDBACK/bazantic.md`).

| operationId | Method + path | Price (mcents) | = USD | Why |
|---|---|---|---|---|
| `listBonds` | `GET /bonds` | `500` | $0.005 | Cheap entry point; agents call it first and often. |
| `getBond` | `GET /bonds/{id}` | `200` | $0.002 | Single-bond detail, one batched `eth_call` round-trip. |
| `getOrderbook` | `GET /bonds/{id}/orderbook` | `1000` | $0.01 | Rebuilds the book from contract storage plus mirror-node trade history. |
| `getBondRisk` | `GET /bonds/{id}/risk` | `1000` | $0.01 | The signal agents actually pay for: coverage plus the last TEE verdict. |
| `getWalletEligibility` | `GET /wallets/{address}/eligibility` | `1000` | $0.01 | Two mirror-node calls plus an ATS KYC read; the compliance answer. |
| `healthz` | `GET /healthz` | `10` | $0.0001 | Priced rather than free, so a liveness probe is still metered. |

One full Recipe run (`recipe.md`) costs `1000 + 500 + 1000 = 2500` mcents = **$0.025** on this gateway, plus the
mirror-node gateway's calls (step 6b).

Upstream auth is set to **No auth** — the Bond Desk API needs no credential — and the dashboard's *Test
connection* returned `Connection OK, HTTP 200`.

## 3. Activate — done, but there is no Activate button

Activation is a field, not a control. The dashboard saves the whole listing with
`PATCH /api/gateways/{slug}` and `action: "update"`, and that body accepts `status: "active"` alongside the
prices, tags, tagline and description. Setting it there is what flipped the gateway to LIVE on 2026-09-11.
Two validation limits, both undocumented, reject the whole PATCH with `400 invalid_request` and no detail —
the UI surfaces only *"We couldn't save your changes"*:

- the description must be roughly **600 characters or fewer**;
- at most **5 tags**.

Publishing to the marketplace requires an active gateway first ("Activate this gateway before you publish it"),
so this step gates the listing too. Confirm from the CLI:

```sh
baz gateway list --json | jq '.listings[] | select(.slug=="'"$SLUG"'") | {status, endpointUrl}'
```

## 4. Check 1 — an unpaid request returns 402 — verified 2026-09-11

```sh
curl -i "$GATEWAY/bonds"      # 402 Payment Required
curl -i "$GATEWAY/healthz"    # 200
```

`GET /bonds` answers `HTTP/1.1 402 Payment Required` with an x402 challenge:

| Field | Value |
|---|---|
| `scheme` | `exact` |
| `network` | `base` (`eip155:8453`) |
| asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| amount | `5000` base units ($0.005, the `listBonds` price) |
| `payTo` | `0x8D6701401BC740C4B93C5856F9565a7Da8e8DF40` |

The `www-authenticate` header carries an MPP challenge alongside it. `/healthz` returns `200`.

If this ever regresses: a `404 page not found` means the gateway went back to `draft` — step 3. A `200` on
`/bonds` means the operation lost its price — step 2. A `502`/`504` means Bazantic cannot reach `$PUBLIC_URL`:
App Runner's smallest instance can cold-start, so `curl $PUBLIC_URL/healthz` once and retry.

## 5. Check 2 — a paid request must return the payload

```sh
baz curl "$GATEWAY/bonds" \
  --account "$(baz whoami --json | jq -r .username)" \
  --max-amount 0.02 --yes --json --verbose
```

`--verbose` prints the x402 settlement (amount, USDC on Base) beside the JSON body — that pairing is the shot for
the demo video. `--max-amount` is a hard USD ceiling; keep it just above the operation price so a mispriced
operation fails loudly instead of spending. Settlement is **Base mainnet USDC**, so the calling account needs a
small real USDC balance; nothing has been spent from this account so far.

Then the expensive operations, to confirm each price is charged independently:

```sh
baz curl "$GATEWAY/bonds/1/risk" --max-amount 0.02 --yes --json
baz curl "$GATEWAY/wallets/$INVESTOR1/eligibility?bondId=1" --max-amount 0.02 --yes --json
```

## 6. Check 3 — MCP `tools/list` exposes the six operations

Bazantic serves each gateway over MCP, so an agent can discover the API without the OpenAPI document:

```sh
curl -s -X POST "$GATEWAY/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq -r '.result.tools[].name'
```

Verified 2026-09-11: the MCP server at `$GATEWAY/mcp` serves exactly the six tools generated from our OpenAPI —
`listBonds`, `getBond`, `getOrderbook`, `getBondRisk`, `getWalletEligibility`, `healthz`. Our `operationId`
values survive into the tool names. Use the MCP URL from the dashboard's connection snippet if it differs from
the `mcpUrl` recorded in step 1.

## 6b. The second gateway the Recipe uses — registered here too

The Recipe's first step needs a **testnet** Hedera Mirror Node. Bazantic's pre-existing "Hedera Mirror Node"
service is **mainnet-only**, so it `404`s for a testnet wallet — and the Recipe runner aborts the entire run on
any tool `404` (`tool_failed`), so it cannot carry a testnet flow at all. We registered the testnet mirror node
as a second gateway from the CLI and activated it exactly as in step 3:

| Field | Value |
|---|---|
| Name | `Hedera Mirror Node (testnet)` |
| `slug` | `txrkgk2mezhbln4aeo2tdji6s4` |
| `endpointUrl` | `https://txrkgk2mezhbln4aeo2tdji6s4.bazgateway.com` |
| Spec | `https://testnet.mirrornode.hedera.com/api/v1/docs/openapi.yml` |
| Operations | 48, all at the default `1000` mcents ($0.01) |

```sh
export MIRROR_GATEWAY=https://txrkgk2mezhbln4aeo2tdji6s4.bazgateway.com
baz curl "$MIRROR_GATEWAY/api/v1/accounts/$INVESTOR1" --max-amount 0.01 --yes --json
```

## 6c. The third gateway — Bank of Canada Valet, the service that was new to Bazantic — registered 2026-09-11

The "Agentify a new API" track wants a service that was **not available through Bazantic and is not a sponsor's API**,
bound into a Recipe next to our own gateway. The Recipe uses it as the sovereign benchmark curve the Bond Desk API
cannot produce (`recipe.md`, step 5: spread over benchmark, and a bond that does not clear the benchmark is not a buy).

### Eligibility check — 2026-09-11 19:14–19:21 UTC

Run against the public catalog MCP at `https://bazgateway.com/mcp` (`list_gateways` returned **108** gateways; `search`
is lexical over name, tags, description and operation words), then against the ETHOnline 2026 prize page, whose
sponsors are The Graph, Hedera, Arc, World, 1inch, ENS, Uniswap Foundation, Ledger, Privy, Chainlink and Bazantic.

| Candidate | `search` query → results | Catalog grep (108 rows) | Sponsor? | Keyless? | Verdict |
|---|---|---|---|---|---|
| Pyth Hermes (preferred) | `pyth` → 0 · `hermes` → 0 · `pyth network` → 0 · `oracle` → 3 unrelated (Sigma86, Spectrum ×2) · `price feed` → 6 unrelated | 0 | no | **no**: `GET https://hermes.pyth.network/v2/updates/price/latest?ids[]=0x3728e5…dfbd&parsed=true` answers `401 unauthorized` (also on hermes-beta and on `benchmarks.pyth.network/v1/updates/price/latest`); only the metadata route `/v2/price_feeds?query=hbar` is still open. Pyth's docs: the Pyth Core upgrade of 2026-08-26 made Hermes require an API key. | rejected — a keyed upstream would 401 through the gateway and abort every Recipe run (`tool_failed`) |
| ECB Data Portal (fallback 1) | `ecb` → **1**: ECB Data Portal, slug `ocxdnwakhfa57mkhqqm4uzw4be`, score 1.92 | 1 | no | yes | rejected — already on Bazantic |
| Bank of Canada Valet (fallback 2) | `canada` → 0 · `valet` → 0 · `bank of canada` → 0 · `benchmark` → 3 unrelated · `treasury` → 3 (US Treasury FiscalData, Sigma86, Glider) | 0 | no | yes: `GET https://www.bankofcanada.ca/valet/observations/group/bond_yields_all/json?recent=1` → 200 with no header at all | **chosen** |

After registration the same searches find it: `canada` → 1 (Bank of Canada Valet, score 0.544), `valet` → 1 (1.229),
and `list_gateways` returns 109.

### The spec and where it is hosted

Valet publishes no fetchable OpenAPI document (its Swagger UI loads a language-specific file from a script), and
Bazantic fetches `--spec-url` server-side, so we wrote a small OpenAPI 3.0.3 document with four operations and
live-fetched examples — `api/bazantic/boc-valet-openapi.json` — and hosted it as a public gist:

- gist: <https://gist.github.com/AbhimanyuAjudiya/32a558a30013e78144f86d54f24d1d4d>
- raw URL that was registered:
  `https://gist.githubusercontent.com/AbhimanyuAjudiya/32a558a30013e78144f86d54f24d1d4d/raw/boc-valet-openapi.json`

| operationId | Method + path | The Recipe uses it for |
|---|---|---|
| `getGroupObservations` | `GET /valet/observations/group/{groupName}/json` | `groupName=bond_yields_all`, `recent=1`: the Government of Canada benchmark curve (2y–long) and the 1–3y / 3–5y / 5–10y / 10y+ average yields in one row — step 5 of the Recipe |
| `getSeriesObservations` | `GET /valet/observations/{seriesNames}/json` | one or more named series, comma-separated |
| `getSeriesDetail` | `GET /valet/series/{seriesName}/json` | the label and description of one series |
| `getGroupDetail` | `GET /valet/groups/{groupName}/json` | the series names inside a group |

### Registration — done, 2026-09-11 19:29 UTC

`--auth-type none` is what the docs now prescribe for a public upstream (`x402-mpp` and `jwt` are documented as
retired and identical to `none`); `--status active` because every method starts at the platform's default price, so
an active gateway is never a free API:

```sh
baz gateway add \
  --spec-url "https://gist.githubusercontent.com/AbhimanyuAjudiya/32a558a30013e78144f86d54f24d1d4d/raw/boc-valet-openapi.json" \
  --endpoint "https://www.bankofcanada.ca" \
  --name "Bank of Canada Valet" \
  --auth-type none --status active --json
# {"ok":true,"id":"e4385834-7613-4f78-955e-99d664b5c310","slug":"4q4fqndwcnhxrfk6thlgjnodca","mcpUrl":"https://4q4fqndwcnhxrfk6thlgjnodca.bazgateway.com/mcp"}
```

| Field | Value |
|---|---|
| Name | `Bank of Canada Valet` |
| `id` | `e4385834-7613-4f78-955e-99d664b5c310` |
| `slug` | `4q4fqndwcnhxrfk6thlgjnodca` |
| `endpointUrl` | `https://4q4fqndwcnhxrfk6thlgjnodca.bazgateway.com` |
| MCP | `https://4q4fqndwcnhxrfk6thlgjnodca.bazgateway.com/mcp` |
| Upstream | `https://www.bankofcanada.ca`, auth `none` |
| Status | `active` from registration (`deployedAt` 2026-09-11T19:29:39Z; `baz gateway list --json` shows all three gateways `active`) |
| Prices | all four operations at the platform default **1000 mcents = $0.01** — the same price as every mirror-node operation and as our `getBondRisk` and `getWalletEligibility` |

Pricing note: the spec carries `x-bazantic-price-millicents` (500/500/200/200) — the extension Bazantic's own
Recipe-gateway spec uses — but registration ignored it: every operation challenges for `10000` base units. Lower
prices still need the dashboard (step 2).

### Checks — 2026-09-11 19:30 UTC

```sh
export BOC_GATEWAY=https://4q4fqndwcnhxrfk6thlgjnodca.bazgateway.com
curl -i "$BOC_GATEWAY/valet/observations/group/bond_yields_all/json?recent=1"   # 402 Payment Required
```

The first pass, about 40 s after registration, answered `404 page not found` on three of the four paths (the gateway
was still provisioning); 30 s later all four answered `HTTP/2 402` with the x402 body
`{"x402Version":1,"accepts":[{"scheme":"exact","network":"base","maxAmountRequired":"10000","resource":"/valet/observations/group/bond_yields_all/json","payTo":"0x8D6701401BC740C4B93C5856F9565a7Da8e8DF40","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",…}]}`,
a `payment-required` header (x402 v2) and a `www-authenticate: Payment … method="tempo"` MPP challenge. The other
three paths checked: `/valet/observations/BD.CDN.2YR.DQ.YLD,BD.CDN.10YR.DQ.YLD/json?recent=1`,
`/valet/series/BD.CDN.2YR.DQ.YLD/json`, `/valet/groups/bond_yields_all/json` — all `402`, amount `10000`.

```sh
curl -s -X POST "$BOC_GATEWAY/mcp" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | sed -n 's/^data: //p' | jq -r '.result.tools[].name'
curl -s "$BOC_GATEWAY/.well-known/agent-card.json" | jq .name
curl -s "$BOC_GATEWAY/openapi.yaml" | grep operationId
```

The MCP server, the agent card and the served spec came up **4 minutes after registration** (polled every 30 s:
`tools/list` first answered at 19:33:46 UTC; `deployedAt` was 19:29:39 UTC). `tools/list` returns our four
operationIds — `getGroupObservations`, `getSeriesObservations`, `getSeriesDetail`, `getGroupDetail` — plus the
platform's own `info` and `externalDocs` tools; the tool inputs carry the spec's parameter names (`groupName`,
`recent`, `start_date`, `end_date`, `order_dir`). `/.well-known/agent-card.json` answers `200` with the MCP interface,
and `/openapi.yaml` serves the spec — still carrying our `x-bazantic-price-millicents` values (500/200) although
every 402 asks for `10000`, so the served spec and the actual price disagree until the dashboard prices are set.
Until the compile finished, `get_gateway` listed the gateway without `mcp`, `agentCard` or `specification`; it
carries all three now.

Public catalog: `get_gateway` for the slug returns `found: true` with the auto-generated description
("Bankofcanada Ca exposed as a per-request HTTP surface…", tags `per-request, x402, MPP, DATA`) — the listing copy in
section 8 replaces it. A paid call has not been made (nothing has been spent); the command is the same as step 5:

```sh
baz curl "$BOC_GATEWAY/valet/observations/group/bond_yields_all/json?recent=1" --max-amount 0.02 --yes --json
```

## 7. Record for the submission

- `baz whoami` username: **Abhimanyu** (the prize requires the account name).
- Gateway `id`, `slug` and `endpointUrl` — recorded in step 1, re-checkable with `baz gateway list --json`.
- The second gateway, `Hedera Mirror Node (testnet)`, slug `txrkgk2mezhbln4aeo2tdji6s4` (step 6b).
- The third gateway, `Bank of Canada Valet`, slug `4q4fqndwcnhxrfk6thlgjnodca`, id
  `e4385834-7613-4f78-955e-99d664b5c310`, spec gist
  <https://gist.github.com/AbhimanyuAjudiya/32a558a30013e78144f86d54f24d1d4d> (step 6c).
- The published Recipe: **Best Eligible Hedera Bond Recommendation**,
  <https://bazantic.com/recipes/best-eligible-hedera-bond-recommendation> (see `recipe.md`).
- The 402 response headers and the `baz curl --verbose` settlement line.
- Screen recording: `dashboard-steps.md` carries the shot list (both 402s, the Recipe's bound tools, a full run).

## 8. Listing copy that still needs the dashboard

The CLI session is accepted by `/api/cli/gateways` only. The listing PATCH the dashboard uses
(`PATCH /api/gateways/{slug}`, `action: "update"`) answers `401` to the CLI bearer token and `/api/cli/gateways/{slug}`
does not exist (`404`), so the three descriptions below have to be pasted in the dashboard (Overview → Your Listings →
the gateway → edit). Limits from step 3: **≤ 600 characters**, **≤ 5 tags**.

**Bond Desk API (Hedera)** — the live description names the Recipe by its pre-publication working title; the
published Recipe is *Best Eligible Hedera Bond Recommendation*. Replace the description with (tags unchanged:
`hedera, bonds, kyc, x402, data`):

> Read-only API for Bond Desk on Hedera testnet: a corporate bond issued through Hedera's Asset Tokenization Studio, traded on an order book that enforces KYC at every fill, coupons scheduled by the Hedera Schedule Service, collateral valued by a live Chainlink HBAR/USD feed. Endpoints: bonds (terms, status, coverage, best bid/ask, yield), order book, risk (status, coverage, last verdict) and wallet eligibility (KYC per bond). Used by the Recipe 'Best Eligible Hedera Bond Recommendation' with Hedera Mirror Node (testnet) and Bank of Canada Valet.

**Hedera Mirror Node (testnet)** — same stale title in its last sentence; replace that sentence with:

> Pairs with the Bond Desk API (Hedera) and Bank of Canada Valet gateways in the Recipe 'Best Eligible Hedera Bond Recommendation'.

**Bank of Canada Valet** — replace the auto-generated copy. Tagline: `Government of Canada benchmark yields and rates,
keyless, daily.` Tags: `canada, yields, benchmark, rates, data`. Documentation URL: `https://www.bankofcanada.ca/valet/docs`.
Description:

> The Bank of Canada's public Valet API: keyless JSON time series. bond_yields_all returns the Government of Canada benchmark curve (2-year to long-term) and the average yields by maturity bucket in one call; tbill_all and FX_RATES_DAILY cover bills and FX. Used by the Recipe 'Best Eligible Hedera Bond Recommendation' as the sovereign benchmark a Hedera bond's yield is spread against. Credit the Bank of Canada as the source when you republish a value.

Verify after saving, without logging in: the public MCP `get_gateway` (slug `axuvor5zujgk5hdcydzjdi742m`) must return
the new description, and `curl -s https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com/.well-known/agent-card.json | jq .description`
must match it.

Nothing in this file, or in anything pasted from it into the repo, may contain a wallet key, a session token, or
the raw `baz` config. The only secret-bearing step is `baz login`, which happens in a browser.
