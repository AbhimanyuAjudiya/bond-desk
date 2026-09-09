# Bond Desk API

Read-only HTTP API over the Bond Desk contracts on Hedera testnet, written for LLM agents: every response is plain JSON
with decimal-string big numbers, and `/openapi.json` carries agent-oriented descriptions plus `x-agent-hints`. It is the
service registered as a Bazantic gateway (see `bazantic/`).

Stack: Hono + `@hono/node-server` + viem + zod on Node 22 (`--experimental-strip-types`, no build step).

## Run

```sh
cd api && npm install
cp .env.example .env        # optional; defaults match testnet
npm start                    # http://localhost:8787
npm run check                # boots against test/deployments.testnet.json and asserts routes, error shapes and openapi.json
npm run typecheck
```

`DEPLOYMENTS_FILE` (default `../deployments/testnet.json`) is the flat JSON written by `contracts/script/Deploy.s.sol`;
the API reads `chainId`, `registry`, `market`, `vault`, `riskGate`. `test/deployments.testnet.json` is a zero-address
placeholder so the server boots before deployment (reads then answer `502 {"error":"upstream"}`).

## Routes

| Route | operationId | Source |
|---|---|---|
| `GET /bonds` | `listBonds` | `BondRegistry.terms`, `BondMarket.quote`, `RiskGate.snapshot`, token `symbol()` (batched `eth_call`, one round-trip per 100 reads: hashio caps JSON-RPC batches at 100) |
| `GET /bonds/:id` | `getBond` | same + raw `terms` |
| `GET /bonds/:id/orderbook` | `getOrderbook` | open orders rebuilt from storage (`nextOrderId` → `orders(i)`), fills from mirror-node `Filled` logs |
| `GET /bonds/:id/risk` | `getBondRisk` | `RiskGate.snapshot` + last `VerdictApplied` log |
| `GET /wallets/:address/eligibility?bondId=` | `getWalletEligibility` | mirror `/accounts/{evm}`, `/accounts/{evm}/tokens`, ATS `getKycStatusFor` |
| `GET /healthz` | `healthz` | `eth_blockNumber` |
| `GET /openapi.json` | – | OpenAPI 3.1, `servers[0].url = PUBLIC_URL` |

Errors: `404 {"error":"bond-not-found"}`, `400 {"error":"bad-address"}`, `502 {"error":"upstream","detail":"<method>"}`.
Status names: `None | Active | Frozen | Matured | Defaulted`; verdict actions: `OK | WARN | FREEZE | DEFAULT`.
`coverageBps` is `null` while the Chainlink feed is stale. Responses are cached in-process for `CACHE_TTL_MS` (10 s).

History comes from the mirror node, not `eth_getLogs`: hashio rejects ranges over 7 days / 1000 blocks (`-32004`), and
the mirror node's topic-filtered log query is also capped to a 7-day window, so the API pages the newest 100 logs of a
contract unfiltered and matches topics locally.

## Deploy

```sh
docker build -f api/Dockerfile -t bond-desk-api .        # from the repo root; needs deployments/testnet.json
docker run -p 8787:8787 -e PUBLIC_URL=https://<host> bond-desk-api
```

`render.yaml` is a Render Blueprint (`runtime: docker`, context = repo root, health check `/healthz`); Render reads it
from the repo root, so copy it there when creating the service. Demo fallback without hosting:
`cloudflared tunnel --url http://localhost:8787` and set `PUBLIC_URL` to the tunnel URL (Bazantic pins the endpoint at
registration, so a new tunnel URL means a new gateway).
