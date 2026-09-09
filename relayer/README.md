# Bond Desk relayer

Lands TEE-signed risk verdicts on Hedera testnet. The CRE `bond-monitor` workflow signs an EIP-712
`Verdict` inside the enclave and returns it as one `VERDICT_JSON {...}` log line; Hedera is not a
CRE-supported chain, so this relayer carries the signed verdict to `RiskGate.submit`. The relayer key
only pays gas — the contract verifies the enclave signer and the nonce, so a rogue relayer can neither
forge nor replay a verdict.

Node 22 (`--experimental-strip-types`, no build step) + viem. No framework.

```
relayer/
  src/index.ts              CLI: submit / watch, relay() flow, retries
  src/riskgate.ts           hederaTestnet chain, EIP-712 types, local verify, viem clients
  src/abi/RiskGate.json     minimal ABI (overwritten by scripts/sync-abi.sh once contracts build)
  scripts/extract-verdict.sh  VERDICT_JSON line from a simulate log -> verdict file
  inbox/                    drop verdict files here for `watch`
  test/fixture.json         verdict signed with a throwaway key; `signer` = its address
  test/nonce.test.ts        node:test with a stubbed RiskGate
```

## Setup

```sh
cd relayer && npm install && cp .env.example .env   # fill RELAYER_PRIVATE_KEY (funded via portal.hedera.com/faucet)
npm run check      # offline: validates + verifies test/fixture.json, prints verified=true
npm test           # nonce idempotency + bad-signature tests (bare `node --test` finds no .ts files: 0 tests, exit 0)
npm run typecheck
```

| env | meaning |
|---|---|
| `HEDERA_RPC_URL` | default `https://testnet.hashio.io/api` |
| `RELAYER_PRIVATE_KEY` | pays gas for `submit`/`watch`; must be a 0x-prefixed 32-byte hex key; not needed for `--dry` |
| `RISKGATE_ADDRESS` | overrides `deployments/testnet.json`; when unset, `--dry` runs fully offline |
| `VERDICT_SIGNER_ADDRESS` | optional; default `RiskGate.signer()` |
| `DEPLOYMENTS_FILE` | default `../deployments/testnet.json` (flat `riskGate` key), used by live runs only |

`npm run relayer` loads `.env` (`--env-file-if-exists`); `npm run check` deliberately does not, so it
stays deterministic — run it with `RISKGATE_ADDRESS` unset.

## Usage

```sh
# from a simulate log
bun run sim:bond 2>&1 | tee ../docs/cre-evidence/bond-monitor.log        # in workflow/
scripts/extract-verdict.sh < ../docs/cre-evidence/bond-monitor.log > inbox/verdict-1.json

npm run relayer -- submit --file inbox/verdict-1.json --dry   # everything except the write
npm run relayer -- submit --file inbox/verdict-1.json         # {"txHash":..,"status":"success","hashscan":..}
npm run relayer -- watch --dir inbox                          # poll every 5s
```

Verdict file (B0.4; bigints as decimal strings):

```json
{ "verdict": { "bondId": "1", "action": 2, "coverageObserved": "10500", "issuedAt": "1789012345", "nonce": "4" },
  "signature": "0x…", "chainId": 296, "riskGate": "0x…", "txHash": null }
```

`submit` flow, in order:

1. validate `chainId == 296` and `riskGate` matches the configured address (exit 1);
2. verify the EIP-712 signature locally against the signer (exit 2, before any RPC write) and print `verified=true`;
3. `{"skipped":"delivered-direct"}` if the file already carries a `txHash` (workflow ran with `deliver: "direct"`);
4. read `RiskGate.snapshot(bondId)`; `{"skipped":"already-applied"}` if `nonce <= lastNonce`;
5. `--dry` stops here (`{"dry":true,...}`); otherwise `submit` as a legacy tx (`gasPrice` from `eth_gasPrice`,
   gas 500000), wait for the receipt, print `{txHash,status,hashscan}` (exit 1 if reverted).

Retries: 3 attempts with 2s·2ⁿ backoff, only for transport/timeout errors; the snapshot is re-read on every
attempt, so a tx that landed during a blip is reported as `already-applied` instead of being re-sent.
A revert (caught by `eth_call` simulation before gas is spent) is printed and never retried.

`--dry` offline mode: with `RISKGATE_ADDRESS` unset the snapshot read is skipped and the signer must come
from `VERDICT_SIGNER_ADDRESS` or a `signer` field in the file (fixtures only). Set `RISKGATE_ADDRESS` to
get an online dry run that also performs the nonce check.

`watch --dir`: every 5s each `*.json` (not `*.done.json`) is submitted; on success or skip the file is
renamed `<name>.done.json`. A file that fails stays in place and is not retried until the process restarts
(so a reverting verdict cannot loop); a file that does not parse (e.g. still being written by `> inbox/x.json`)
is logged and retried on the next tick. Ticks never overlap.

Exit codes: 0 ok/skipped · 1 error or revert · 2 bad signature.

## Fixture

`test/fixture.json` was signed by `node --experimental-strip-types test/make-fixture.ts` with a freshly
generated key that was discarded; its address is recorded as `signer` so `npm run check` verifies offline.
Re-run the script to regenerate (the domain uses `riskGate = 0x0`, so it stays valid across deployments).
