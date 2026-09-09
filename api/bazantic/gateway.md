# Bazantic gateway — registration runbook

Registers the **Bond Desk API** as a paid, agent-callable service on Bazantic. Every command below is
copy-paste runnable once `$PUBLIC_URL` is a public HTTPS origin serving `/openapi.json` (the Render service, or
`cloudflared tunnel --url http://localhost:8787` as a fallback).

The endpoint URL is **fixed at registration**: a tunnel URL changes on every restart, and a changed URL means a
new gateway. Prefer the Render deployment for anything that will be demoed.

## 0. Prerequisites

```sh
npm i -g @bazantic/cli
baz login          # device sign-in, approved in a browser
baz whoami         # the account username the Bazantic prize submission asks for
baz wallet         # USDC funding address (Base; base-sepolia for testnet)
```

```sh
export PUBLIC_URL=https://bond-desk-api.onrender.com
export INVESTOR1=$(jq -r .wallets.investorKyc1 deployments/testnet.json)   # a real 0x… address; the API 400s on anything else
curl -sf "$PUBLIC_URL/healthz" | jq .            # {"ok":true,"chainId":296,"block":…}
curl -sf "$PUBLIC_URL/openapi.json" | jq -r '.info.title, (.paths | keys[])'
```

Both must succeed **before** registering — Bazantic fetches the spec at registration time.

## 1. Register the gateway

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
a free API. Record the returned `endpointUrl` and the slug:

```sh
baz gateway list --json | jq '.[] | {id, name, slug, endpointUrl, status}'
export SLUG='<slug-from-above>'
```

Dashboard note: the gateway form's OpenAPI field has a **URL / Paste toggle**, so the spec document itself need
not be hosted — but the API endpoint must be. Use the URL side (`$PUBLIC_URL/openapi.json`) so the gateway
re-reads the spec this repo ships (`api/src/openapi.ts`) instead of a pasted copy that drifts.

## 2. Price every operation

Dashboard → the gateway → per-method pricing. Prices are **USDC base units (6 decimals)**. There is no CLI flag
for pricing today (see `docs/FEEDBACK/bazantic.md`).

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

## 3. Activate

Dashboard → status **active**. Confirm from the CLI:

```sh
baz gateway list --json | jq '.[] | select(.slug=="'"$SLUG"'") | {status, endpointUrl}'
```

## 4. Check 1 — an unpaid request must return 402

```sh
curl -i "https://bazgateway.com/$SLUG/bonds"
```

Expect `HTTP/1.1 402 Payment Required` with a payment challenge naming the `listBonds` price (5000). A `200`
means the operation is still unpriced — go back to step 2. A `502`/`504` means Bazantic cannot reach
`$PUBLIC_URL`: on Render's free tier the first request after idle is a cold start, so `curl $PUBLIC_URL/healthz`
once and retry.

## 5. Check 2 — a paid request must return the payload

```sh
baz curl "https://bazgateway.com/$SLUG/bonds" \
  --account "$(baz whoami --json | jq -r .username)" \
  --max-amount 0.02 --yes --json --verbose
```

`--verbose` prints the x402 settlement (amount, USDC on Base) beside the JSON body — that pairing is the shot for
the demo video. `--max-amount` is a hard USD ceiling; keep it just above the operation price so a mispriced
operation fails loudly instead of spending.

Then the expensive operations, to confirm each price is charged independently:

```sh
baz curl "https://bazgateway.com/$SLUG/bonds/1/risk" --max-amount 0.02 --yes --json
baz curl "https://bazgateway.com/$SLUG/wallets/$INVESTOR1/eligibility?bondId=1" --max-amount 0.02 --yes --json
```

## 6. Check 3 — MCP `tools/list` exposes the six operations

Bazantic serves each gateway over MCP, so an agent can discover the API without the OpenAPI document:

```sh
curl -s -X POST "https://bazgateway.com/$SLUG/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq -r '.result.tools[].name'
```

Expect exactly the six operationIds from the table. If the tools come back as generated slugs instead of our
`operationId` values, the spec's operationIds are being ignored — record it in `docs/FEEDBACK/bazantic.md`. Use
the MCP URL the dashboard's connection snippet prints if it differs from `/<slug>/mcp`.

## 6b. The second service the Recipe uses

The Recipe also calls **Hedera Mirror Node**, which is already a Bazantic service — nothing to register. Confirm
it resolves for your account before recording the A/B run:

```sh
export MIRROR_SLUG='<hedera-mirror-node-slug-from-the-dashboard-catalogue>'
baz curl "https://bazgateway.com/$MIRROR_SLUG/api/v1/accounts/$INVESTOR1" --max-amount 0.01 --yes --json
```

## 7. Record for the submission

- `baz whoami` username (the prize requires the account name).
- Gateway slug and `endpointUrl` from `baz gateway list --json`.
- The 402 response headers and the `baz curl --verbose` settlement line.
- Screen recording of step 4 → step 5 → the Recipe answer (see `recipe.md`).

Nothing in this file, or in anything pasted from it into the repo, may contain a wallet key, a session token, or
the raw `baz` config. The only secret-bearing step is `baz login`, which happens in a browser.
