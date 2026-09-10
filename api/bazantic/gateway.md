# Bazantic gateway — registration runbook

Registers the **Bond Desk API** as a paid, agent-callable service on Bazantic. Steps 0 and 1 have been run: the
gateway exists as a **draft**. Steps 2 and 3 are dashboard-only and are the remaining manual work; steps 4 to 6
cannot pass until the gateway is active.

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

`--status draft` is deliberate: prices are set in the dashboard, and a live gateway with unpriced operations is
a free API. The returned record:

| Field | Value |
|---|---|
| `id` | `05e95747-b9a2-4cae-9c62-c0f291a3fcd3` |
| `slug` | `axuvor5zujgk5hdcydzjdi742m` |
| `endpointUrl` | `https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com` |
| `mcpUrl` | `https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com/mcp` |
| `category` | `data` |
| `status` | `draft` |

The gateway URL is a **subdomain per slug** — `https://<slug>.bazgateway.com` — not a path under
`bazgateway.com`. Export it once and use it for every call below:

```sh
export SLUG=axuvor5zujgk5hdcydzjdi742m
export GATEWAY="https://$SLUG.bazgateway.com"
baz gateway list --json | jq '.[] | {id, name, slug, endpointUrl, status}'
```

While the gateway is `draft` it routes nothing: `GET $GATEWAY/bonds` and `POST $GATEWAY/mcp` both answer
`404 page not found` from Fly's edge rather than a 402 challenge. Activation (step 3) is what turns the routes
on.

Dashboard note: the gateway form's OpenAPI field has a **URL / Paste toggle**, so the spec document itself need
not be hosted — but the API endpoint must be. We used the URL side (`$PUBLIC_URL/openapi.json`) so the gateway
re-reads the spec this repo ships (`api/src/openapi.ts`) instead of a pasted copy that drifts.

## 2. Price every operation — dashboard, pending

Dashboard → the gateway → per-method pricing. Prices are **USDC base units (6 decimals)**. There is no CLI path
for pricing: `baz --help` lists `login`, `logout`, `whoami`, `gateway add|list`, `curl`, `wallet` and `grant`,
and nothing else (see `docs/FEEDBACK/bazantic.md`).

| operationId | Method + path | Price (USDC base units) | = USD | Why |
|---|---|---|---|---|
| `listBonds` | `GET /bonds` | `5000` | $0.005 | Cheap entry point; agents call it first and often. |
| `getBond` | `GET /bonds/{id}` | `2000` | $0.002 | Single-bond detail, one batched `eth_call` round-trip. |
| `getOrderbook` | `GET /bonds/{id}/orderbook` | `10000` | $0.010 | Rebuilds the book from contract storage plus mirror-node trade history. |
| `getBondRisk` | `GET /bonds/{id}/risk` | `10000` | $0.010 | The signal agents actually pay for: coverage plus the last TEE verdict. |
| `getWalletEligibility` | `GET /wallets/{address}/eligibility` | `10000` | $0.010 | Two mirror-node calls plus an ATS KYC read; the compliance answer. |
| `healthz` | `GET /healthz` | `100` | $0.0001 | Priced rather than free, so a liveness probe is still metered. |

One full Recipe run (`recipe.md`) costs `10000 + 5000 + 10000 = 25000` base units = **$0.025** on this gateway,
plus whatever the Hedera Mirror Node service charges for its two calls.

## 3. Activate — dashboard, pending

Dashboard → status **active**. There is no CLI flag for this either. Confirm from the CLI once it is done:

```sh
baz gateway list --json | jq '.[] | select(.slug=="'"$SLUG"'") | {status, endpointUrl}'
```

Steps 2 and 3, plus authoring the Recipe from `recipe.md`, are the whole of the remaining manual work, and all
three are dashboard-only.

## 4. Check 1 — an unpaid request must return 402

```sh
curl -i "$GATEWAY/bonds"
```

Expect `HTTP/1.1 402 Payment Required` with a payment challenge naming the `listBonds` price (5000). A
`404 page not found` means the gateway is still `draft` — go back to step 3. A `200` means the operation is
still unpriced — go back to step 2. A `502`/`504` means Bazantic cannot reach `$PUBLIC_URL`: App Runner's
smallest instance can cold-start, so `curl $PUBLIC_URL/healthz` once and retry.

## 5. Check 2 — a paid request must return the payload

```sh
baz curl "$GATEWAY/bonds" \
  --account "$(baz whoami --json | jq -r .username)" \
  --max-amount 0.02 --yes --json --verbose
```

`--verbose` prints the x402 settlement (amount, USDC on Base) beside the JSON body — that pairing is the shot for
the demo video. `--max-amount` is a hard USD ceiling; keep it just above the operation price so a mispriced
operation fails loudly instead of spending.

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

Expect exactly the six operationIds from the table. If the tools come back as generated slugs instead of our
`operationId` values, the spec's operationIds are being ignored — record it in `docs/FEEDBACK/bazantic.md`. Use
the MCP URL from the dashboard's connection snippet if it differs from the `mcpUrl` recorded in step 1.

## 6b. The second service the Recipe uses

The Recipe also calls **Hedera Mirror Node**, which is already a Bazantic service — nothing to register. Confirm
it resolves for your account before recording the A/B run:

```sh
export MIRROR_GATEWAY='https://<hedera-mirror-node-slug>.bazgateway.com'
baz curl "$MIRROR_GATEWAY/api/v1/accounts/$INVESTOR1" --max-amount 0.01 --yes --json
```

## 7. Record for the submission

- `baz whoami` username: **Abhimanyu** (the prize requires the account name).
- Gateway `id`, `slug` and `endpointUrl` — recorded in step 1, re-checkable with `baz gateway list --json`.
- The 402 response headers and the `baz curl --verbose` settlement line.
- Screen recording of step 4 → step 5 → the Recipe answer (see `recipe.md`).

Nothing in this file, or in anything pasted from it into the repo, may contain a wallet key, a session token, or
the raw `baz` config. The only secret-bearing step is `baz login`, which happens in a browser.
