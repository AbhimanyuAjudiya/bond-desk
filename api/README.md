# Bond Desk API

Read-only HTTP API over the Bond Desk contracts on Hedera testnet, written for LLM agents: every response is plain JSON
with decimal-string big numbers, and `/openapi.json` carries agent-oriented descriptions plus `x-agent-hints`.

It is hosted at **https://wd6nrvmajt.ap-south-1.awsapprunner.com** and is live as a Bazantic gateway at
**https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com** (slug `axuvor5zujgk5hdcydzjdi742m`, status active, MCP at
`/mcp`, published to the marketplace pending Bazantic's listing verification). An unpaid `GET /bonds` on the
gateway answers `402` with an x402 challenge. Prices, checks and the activation record are in
`bazantic/gateway.md`; the published Recipe is in `bazantic/recipe.md`.

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

Live on **AWS App Runner** (`ap-south-1`, smallest instance) at
`https://wd6nrvmajt.ap-south-1.awsapprunner.com`, from this image pushed to ECR:

```sh
docker build -f api/Dockerfile -t bond-desk-api .        # from the repo root; needs deployments/testnet.json
docker run -p 8787:8787 -e PUBLIC_URL=https://<host> bond-desk-api
```

App Runner health-checks `/healthz` and supplies `PUBLIC_URL`, which is what `servers[0].url` in
`/openapi.json` reports. `render.yaml` at the repo root is a Render Blueprint (`runtime: docker`,
`dockerfilePath: ./api/Dockerfile`, context = repo root, health check `/healthz`) kept as an alternative host
rather than the deployment in use. Bazantic pins a gateway's endpoint at registration, so moving the API to a
different host means a new gateway.
