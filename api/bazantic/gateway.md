# Bazantic gateway — registration runbook

Registers the **Bond Desk API** as a paid, agent-callable service on Bazantic. Every step below has been run:
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
`servers[0].url` equal to `$PUBLIC_URL` and the six operations priced below.

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
baz gateway list --json | jq '.[] | {id, name, slug, endpointUrl, status}'
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
baz gateway list --json | jq '.[] | select(.slug=="'"$SLUG"'") | {status, endpointUrl}'
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

## 7. Record for the submission

- `baz whoami` username: **Abhimanyu** (the prize requires the account name).
- Gateway `id`, `slug` and `endpointUrl` — recorded in step 1, re-checkable with `baz gateway list --json`.
- The second gateway, `Hedera Mirror Node (testnet)`, slug `txrkgk2mezhbln4aeo2tdji6s4` (step 6b).
- The published Recipe: **Best Eligible Hedera Bond Recommendation**,
  <https://bazantic.com/recipes/best-eligible-hedera-bond-recommendation> (see `recipe.md`).
- The 402 response headers and the `baz curl --verbose` settlement line.
- Screen recording of step 4 → step 5 → the Recipe answer.

Nothing in this file, or in anything pasted from it into the repo, may contain a wallet key, a session token, or
the raw `baz` config. The only secret-bearing step is `baz login`, which happens in a browser.
