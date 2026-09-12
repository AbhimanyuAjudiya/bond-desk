# Runbook

Every command to build, test, deploy and demo Bond Desk, in order. The [docs site](https://bond-desk.mintlify.site/run/prerequisites) has the same material page by page.

Toolchain, once: Foundry 1.5.x (`forge`), Node 22.9+ (`--experimental-strip-types`, no build step; `api` pins it
in `engines`), Bun 1.2.21+ for the CRE workflows, and `jq`. `harness/scripts/doctor.sh` checks the
Hedera-specific half of that.

Contracts and harness, no credentials needed:

```sh
forge build
forge test                                   # 150 passed, 7 skipped (fork tests)
FOUNDRY_PROFILE=harness forge test           # 42 passed: HSS/HTS mocks, probe loop, response codes, the lag
FORK=1 forge test --match-path 'contracts/test/fork/*' --fork-url https://testnet.hashio.io/api
```

Off-chain, no credentials needed. Each line is run from the repo root and returns you there:

```sh
(cd workflow && bun install && bun test && bun run typecheck)   # 17 tests: decide ladder, policy parsing, rpc, fake-runtime handler
(cd relayer  && npm install && npm run check)                   # offline: prints verified=true on test/fixture.json
(cd relayer  && npm test && npm run typecheck)
(cd api      && npm install && npm run check)                   # placeholder deployment: asserts routes + openapi.json
(cd api      && npm start)                                      # http://localhost:8787/healthz
(cd web      && npm install && npm run typecheck && npm test)   # 27 tests: error decoding, coverage, formatting, verdict verification
(cd web      && npm run build)                                  # -> api/public, served by the API at /
```

CRE simulations need `cre login` (browser) and a `CRE_ETH_PRIVATE_KEY` in `workflow/.env`, even though the bond
workflow spends nothing:

```sh
cd workflow
cp .env.example .env                          # fill CRE_ETH_PRIVATE_KEY, CRE_VERDICT_SIGNER_KEY, the thresholds
bun run sim:bond 2>&1 | tee ../docs/cre-evidence/bond-monitor-$(date +%Y%m%d-%H%M).log
bun run sim:liq  2>&1 | tee ../docs/cre-evidence/liquidation-protection-$(date +%Y%m%d-%H%M).log
bun run setup:challenge                       # once: approve vUSD/vETH then join() on Sepolia
```

Deploy sequence, in this order (needs a funded Hedera key; see `harness/FAUCET.md`):

```sh
source .env                                   # HEDERA_PRIVATE_KEY, RISK_SIGNER, INVESTOR*
export HEDERA_RPC_URL=https://testnet.hashio.io/api

# 1. create the bond on the existing ATS factory; writes ats/testnet.json .bond
forge script ats/script/CreateBond.s.sol:CreateBond --rpc-url hedera --broadcast --slow

# 2. deploy the six desk contracts, wire roles, register the bond, fund the lifecycle, schedule coupon 1.
#    --skip-simulation is mandatory: forge's local EVM has no code at 0x16b.
export BOND_TOKEN=$(jq -r .bond.token ats/testnet.json)
export HBAR_USD_FEED=0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a
forge script contracts/script/Deploy.s.sol:Deploy --rpc-url hedera --broadcast --slow --skip-simulation

# 3. overwrite the artifact's .schedule with the on-chain HSS address (no broadcast, no etch)
forge script contracts/script/Deploy.s.sol:Deploy --sig 'patchSchedule()' --rpc-url hedera

#    to re-schedule a coupon by hand, note that a call reaching 0x16b needs an explicit gas limit:
#    cast send "$(jq -r .lifecycle deployments/testnet.json)" 'schedule(uint256)' 1 \
#      --private-key "$HEDERA_PRIVATE_KEY" --gas-limit 3000000 --rpc-url hedera
#    then re-run patchSchedule() so validate-schedule.sh points at the new entity.

# 4. verify every contract on Sourcify, with HashScan's verifier as the fallback
contracts/script/verify.sh deployments/testnet.json

# 5. the storyline, one beat at a time
FS="forge script contracts/script/Demo.s.sol:Demo --rpc-url hedera --broadcast --slow --skip-simulation"
$FS --sig 'runApprovals()'
$FS --sig 'runIssuerSell()'
forge script contracts/script/Demo.s.sol:Demo --sig 'runRejectedBuy()' --rpc-url hedera   # read-only
$FS --sig 'runKycBuy()'
$FS --sig 'runCollateral()'
$FS --sig 'runCoupon()'
harness/scripts/validate-schedule.sh "$(jq -r .schedule deployments/testnet.json)" --wait 300
```

Relaying a verdict from a simulation log:

```sh
relayer/scripts/extract-verdict.sh < docs/cre-evidence/bond-monitor-20260910-1533-freeze.log \
  > relayer/inbox/freeze.json
cd relayer
RISKGATE_ADDRESS=0x1dFF1d5458D6a6f6af46014de76474DC3170C31B npm run relayer -- \
  submit --file inbox/freeze.json
```

