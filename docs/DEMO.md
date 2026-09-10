# Demo script, 3:50 cut

ETHGlobal's uploader caps the video at **4:00** and the floor for a serious submission is 2:00. This is a 3:50
cut in seven segments; the trim list at the bottom takes it to 2:00 if the recording runs long.

Everything below is run live except the diagram. Nothing here deploys anything: deployment, bond creation, KYC
and the first coupon schedule all happened **before** recording, so the video shows a system that is already
running. The transactions this script replays are the ones already recorded in the root `README.md` storyline,
so every shot is linkable afterwards.

## Before you hit record

```sh
cd bond-desk                    # the clone directory
source .env                     # from .env.example: HEDERA_PRIVATE_KEY, RISK_SIGNER_KEY, INVESTOR1_KEY, INVESTOR3_KEY
                                # RELAYER_PRIVATE_KEY is not in this file: it lives in relayer/.env (see relayer/.env.example)
export HEDERA_RPC_URL=https://testnet.hashio.io/api

# addresses come from the deploy artifact, never retyped
export MARKET=$(jq -r .market    deployments/testnet.json)   # 0x9e393461E165E9975A0A74f7FC378E6C342104B1
export GATE=$(jq -r .riskGate    deployments/testnet.json)   # 0x1dFF1d5458D6a6f6af46014de76474DC3170C31B
export VAULT=$(jq -r .vault      deployments/testnet.json)   # 0x82db4a2ba9859816D60E3d3CE2F6F1E29818FaF7
export TOKEN=$(jq -r .token      deployments/testnet.json)   # 0x0100526434C821d0df24f6CC60352F830F8b4504
export SCHEDULE=$(jq -r .schedule deployments/testnet.json)  # 0x00000000000000000000000000000000009F9174 -> 0.0.10457460
export BOND_ID=$(jq -r .bondId   deployments/testnet.json)   # 1
export INVESTOR1=$(jq -r .wallets.investorKyc1 deployments/testnet.json)
export INVESTOR3_NOKYC=$(jq -r .wallets.investorNoKyc deployments/testnet.json)
export API=https://wd6nrvmajt.ap-south-1.awsapprunner.com    # hosted on App Runner; `cd api && npm start` serves
                                                             # the same routes on http://localhost:8787

FS="forge script contracts/script/Demo.s.sol:Demo --rpc-url hedera --broadcast --slow --skip-simulation"
```

`--skip-simulation` is not optional on any beat. `Demo.s.sol` etches `MockHSS` at `0x16b` in `setUp()` for the
local run, and forge's own EVM has no code there, so without it a replay of the collected transactions reverts
locally and nothing is sent. `--slow` keeps the relay from dropping a nonce.

Pre-flight, all four must pass:

```sh
cast chain-id --rpc-url "$HEDERA_RPC_URL"                                            # 296
cast balance "$(cast wallet address --private-key $HEDERA_PRIVATE_KEY)" --rpc-url "$HEDERA_RPC_URL" --ether
curl -sf "$API/healthz" | jq .                                                       # {"ok":true,"chainId":296,...}
$FS --sig 'runApprovals()'                                                           # idempotent; do it now, not on camera
```

Screen setup: one terminal at ~18pt, one browser with three tabs pre-loaded, being the rendered
`docs/architecture.md`, HashScan on the bond token, and the mirror node's
`/api/v1/schedules/0.0.10457460`. Do not switch tabs mid-command.

If the bond is currently `Frozen` from a previous rehearsal, reset it before recording:

```sh
$FS --sig 'runUnfreeze()'
cast call "$GATE" 'snapshot(uint256)' "$BOND_ID" --rpc-url "$HEDERA_RPC_URL"   # status field must be 1 (Active)
```

---

## 1 · 0:00–0:20 · What this is

**On screen:** the flowchart from `docs/architecture.md`.

**Say:** a transfer-agent-issued corporate bond on Hedera, an order book that refuses non-compliant fills at the
contract level, coupons that fire from Hedera's own scheduler, and a Chainlink CRE enclave that watches
collateral coverage against thresholds nobody on-chain can read, and can freeze the market.

Hold on the diagram; no typing. Point at the one line that matters: the enclave signs, a courier relays, because
Hedera is not a CRE-supported chain.

---

## 2 · 0:20–0:50 · A real ATS bond, with real KYC

**On screen:** HashScan tab on `$TOKEN`, then the terminal.

```sh
cast call "$TOKEN" 'getKycStatusFor(address)(uint8)' "$INVESTOR1"       --rpc-url "$HEDERA_RPC_URL"   # 1
cast call "$TOKEN" 'getKycStatusFor(address)(uint8)' "$INVESTOR3_NOKYC" --rpc-url "$HEDERA_RPC_URL"   # 0
curl -s "$API/bonds" | jq '.bonds[0] | {symbol, status, faceValue, couponRateBps, maturity}'
```

**Say:** the token was issued through the Asset Tokenization Studio factory already deployed on Hedera testnet
at `0xd1F118A4…78379d`. We did not fork it, we called it. Two investors hold KYC, one deliberately does not. The
API is reading the chain live.

Optional cutaway to the issuance transaction on HashScan:
`https://hashscan.io/testnet/transaction/0xf12ba21df080b14138f1a48adc31bb777ed192278d71f87ae98c021212bcf173`.

---

## 3 · 0:50–1:25 · Compliance is enforced by the contract, not the UI

The issuer's ask already exists as order 1 (20 bonds at 0.99 USDC), so the sell is optional on camera. Show the
rejection first, then the fill.

```sh
# the non-KYC buyer, as a read-only call so the revert reason prints instead of a failed tx:
cast call "$MARKET" 'fill(uint256,uint128)' 1 10 --from "$INVESTOR3_NOKYC" --rpc-url "$HEDERA_RPC_URL"
# -> reverts 0x5afab9b8 = ComplianceRejected(0x10, 0xfc855b1b) -> InvalidKycStatus, EIP-1066 code 0x10

forge script contracts/script/Demo.s.sol:Demo --sig 'runRejectedBuy()' --rpc-url hedera   # decodes it for you
```

`runRejectedBuy()` needs no `--broadcast`. It prints, against live chain state:

```
canTransferFrom(issuer -> inv3, 10): ok=false code=0x10
  reason selector: 0xfc855b1b
fill(1, 10) by inv3 reverted with 0x5afab9b8
  ComplianceRejected(code 0x10, reason 0xfc855b1b)
```

Then the same order, a different wallet:

```sh
$FS --sig 'runKycBuy()'                                              # inv1 fills 10 of order 1
curl -s "$API/bonds/$BOND_ID/orderbook" | jq '{bestBid, bestAsk, asks, trades: .trades[0:2]}'
```

**Say:** the rejection is `canTransferFrom` on the ATS token, called inside `fill`, before any transfer. The
same order fills for a KYC'd buyer a second later. The API's book is rebuilt from contract storage; the trade
history comes from the mirror node.

Recorded: the fill is
`https://hashscan.io/testnet/transaction/0x07e85a43f2528f87172d71beaf61f60d8f0552859d01b29bf7536dbb7d067bd4`.

---

## 4 · 1:25–1:50 · Collateral, and a coupon Hedera scheduled itself

```sh
$FS --sig 'runCollateral()'                          # deposit 100 HBAR
forge script contracts/script/Demo.s.sol:Demo --sig 'runStatus()' --rpc-url hedera
# status 1 | feedFresh true | coverageBps 762
# collateral raw 10000000000 = 100 HBAR if tinybar (Hedera) / 0 HBAR if 18-dec (anvil)

curl -s "$API/bonds/$BOND_ID/risk" | jq '{status, coverageBps, mark}'

harness/scripts/validate-schedule.sh "$SCHEDULE" --wait 300
```

**Say:** collateral is native HBAR, valued against the Chainlink HBAR/USD feed on Hedera testnet at
`0x59bC155E…c92B4a`. Coverage is computed on-chain, not by us, and it comes back as 762 basis points. The coupon
was scheduled through HIP-1215 `scheduleCall` on the `0x16b` system contract, and the mirror node is what proves
it fired. No bot, no keeper. Claims are pull-based over an ATS snapshot.

`validate-schedule.sh` is the proof shot: it polls the mirror node and exits 0 only once
`executed_timestamp != null`. Coupon 1's schedule has already executed, so this exits 0 immediately and the
shot is deterministic:

```sh
curl -s https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.10457460 \
  | jq '{schedule_id, expiration_time, executed_timestamp}'   # executed_timestamp 1789035662.019503208
```

Pause on `executed_timestamp`. Then show the coupon it paid and the claim, both live reads:

```sh
LIFECYCLE=$(jq -r .lifecycle deployments/testnet.json)   # 0x044eB54FcA9488356A06121e767cba552a1E5C1B
cast call "$LIFECYCLE" 'coupons(uint256,uint256)(uint256,uint256,uint256,uint64)' 1 1 --rpc-url "$HEDERA_RPC_URL"
# 1  13698  1369  1789035661   = snapshotId, amount, claimedTotal, paidAt
cast call "$LIFECYCLE" 'scheduleOf(uint256)(address)' 1 --rpc-url "$HEDERA_RPC_URL"
# 0x...9f9176 = 0.0.10457462, the NEXT coupon, scheduled from inside the executed one
```

**Say, and this is the line worth landing:** 13,698 USDC base units is 100 bonds at 1 USDC face, 5% a year, for
one day. Investor 1 holds 10 of the 100 and claimed 1,369 of it. And the call the Schedule Service executed
scheduled the next coupon from inside itself, due 86,400 seconds later, so the timer winds itself.

Optional, only if you want the honest-engineering beat and have the seconds: the *first* schedule
(`0.0.10456917`) executed on time and the `payCoupon` inside it reverted out of gas, because `SCHEDULE_GAS` did
not cover the nested re-schedule. That is why `BondLifecycle` was redeployed with a 4,000,000 gas budget. Cut
this first if the segment runs long; the working coupon is the shot.

`$FS --sig 'runCoupon()'` is idempotent here and prints the coupon and the claim, so it is a fine substitute for
the two `cast call` reads if you would rather show one command.

---

## 5 · 1:50–2:45 · The confidential monitor freezes the market

The centrepiece. Four commands, one story, and the coverage drop is real.

```sh
cd workflow
bun run sim:bond 2>&1 | tee ../docs/cre-evidence/bond-monitor-$(date +%Y%m%d-%H%M)-warn.log
```

Point at three things: the simulator's `Handler requested TEE Execution` banner, the `[USER LOG]` line
`bond-monitor bond=1 status=Active coverage=<100% action=WARN reason=below-warn nonce=1`, and the fact that the
coverage in the log is a bucket. The exact number and every threshold stay inside the enclave. The last line is
`VERDICT_JSON {…}`, signed EIP-712, inside the handler, with a key that has never touched this machine.

Relay it:

```sh
cd ..
LOG=$(ls -t docs/cre-evidence/bond-monitor-*-warn.log | head -1)
relayer/scripts/extract-verdict.sh < "$LOG" > relayer/inbox/warn.json
cd relayer && RISKGATE_ADDRESS="$GATE" npm run relayer -- submit --file inbox/warn.json
```

Prints `verified=true`, then `{"txHash":…,"status":"success","hashscan":…}`. **Say:** the relayer verified the
signature locally before it spent a single unit of gas. `RiskGate` checks the signature and the nonce, not the
sender, so the courier is unprivileged and replaceable.

Now take collateral out. Nothing about the policy changes; the bond just gets riskier.

```sh
cd ..
# 2000000000 = 20 HBAR in tinybar. The vault stores collateral in the units the Hedera EVM sees, and a
# function argument is not scaled by the relay the way `value` is.
cast send "$VAULT" 'withdraw(uint256,uint256)' "$BOND_ID" 2000000000 \
  --private-key "$HEDERA_PRIVATE_KEY" --gas-limit 400000 --rpc-url "$HEDERA_RPC_URL"
```

**Say out loud why the `--gas-limit` is there:** the relay's `eth_estimateGas` under-estimates a contract call
that forwards native HBAR, so the first attempt reverted. This is the one Hedera-specific flag in the whole
demo.

```sh
cd workflow
bun run sim:bond 2>&1 | tee ../docs/cre-evidence/bond-monitor-$(date +%Y%m%d-%H%M)-freeze.log
```

Same code, same config hash, 610 basis points instead of 762, and the verdict is now
`action=FREEZE reason=below-freeze nonce=2`.

```sh
cd ..
LOG=$(ls -t docs/cre-evidence/bond-monitor-*-freeze.log | head -1)
relayer/scripts/extract-verdict.sh < "$LOG" > relayer/inbox/freeze.json
cd relayer && RISKGATE_ADDRESS="$GATE" npm run relayer -- submit --file inbox/freeze.json
cd ..

cast call "$MARKET" 'fill(uint256,uint128)' 1 5 --from "$INVESTOR1" --rpc-url "$HEDERA_RPC_URL"
# -> reverts 0x34823ce5 = BondNotActive(1, 2)
curl -s "$API/bonds/$BOND_ID/risk" | jq '{status, lastVerdict}'
```

**Say:** a KYC'd buyer, a valid order, and the fill still reverts. Compliance and risk are separate gates and
both live in the contract. The market is frozen because an enclave said so, and the nonce went from 1 to 2, so
neither verdict can be replayed.

Recorded relays, if you need to cut away rather than re-run:
[WARN](https://hashscan.io/testnet/transaction/0xe534d72b2f9ec132756dc66b63e1476b05a50d13f8613b69a327ac6e085dd7b6),
[FREEZE](https://hashscan.io/testnet/transaction/0x18d46f9627d0e7808d2c78d73848c5aefd813d73147bd19abc74c8e0573db14e).

Leave it frozen. Segment 6 asks a paying agent about this exact bond while it is frozen, and unfreezes on
camera afterwards.

---

## 6 · 2:45–3:25 · The API is an agent-payable product

The API is hosted on AWS App Runner at `$API`, and the gateway is registered as
**`https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com`** — still `draft`, so it answers `404 page not found`
rather than a 402. Three dashboard-only steps stand between here and the live shots below, all of them in
`api/bazantic/gateway.md`: set the six prices, flip the status to active, and author the Recipe from
`api/bazantic/recipe.md`. Then run the six-session protocol in `api/bazantic/ab-test.md`; until it runs, the A/B
table has no numbers.

Once the gateway is active, the shots are:

```sh
export GATEWAY=https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com
curl -i "$GATEWAY/bonds" | head -20                                # 402 Payment Required + price
baz curl "$GATEWAY/bonds" --max-amount 0.02 --yes --json --verbose
```

**On screen next:** the Bazantic UI running the Recipe *"Best eligible Hedera bond for a wallet"* against
`$INVESTOR1`, a KYC'd wallet, asked about a bond that is still frozen from segment 5. The agent reaches
`GET /bonds/{id}/risk`, reads `status: "Frozen"`, and refuses to recommend it, naming the coverage and the
verdict nonce.

Then lift the freeze on camera and ask the identical question again:

```sh
$FS --sig 'runUnfreeze()'
forge script contracts/script/Demo.s.sol:Demo --sig 'runStatus()' --rpc-url hedera   # status 1
```

Same wallet, same prompt, same Recipe text. This run returns the bond with its yield, its ask, its coverage and
a HashScan link. The demo ends with a live book.

Finish with the A/B table from `docs/bazantic-ab/README.md` on screen for three seconds: same model, same
prompt, same tools, with and without the Recipe.

**Say:** the Recipe chains an existing Bazantic service, Hedera Mirror Node, with this new one; the agent pays
per call in USDC over x402; and the enclave's verdict from the previous segment, not a change to the Recipe, is
what flipped the answer from a refusal to a recommendation.

**Fallback if the gateway is still draft:** run `runUnfreeze()` on camera anyway, show
`curl -s "$API/wallets/$INVESTOR1/eligibility?bondId=1"` next to
`curl -s "$API/wallets/$INVESTOR3_NOKYC/eligibility?bondId=1"` (`canHold: true` versus `canHold: false, reason:
"no-kyc"`) against the public URL, and say the gateway is registered but not yet priced or activated. Do not
show a 402 that did not happen.

Recorded unfreeze:
`https://hashscan.io/testnet/transaction/0x00915e79ecb638a2713c5f4de923aea26c96b89bdc8994d8eac6a49b6bd8b10c`.

---

## 7 · 3:25–3:50 · The harness, and the Chainlink challenge

```sh
harness/scripts/loc.sh                       # before/after table for the HSS + HTS boilerplate
FOUNDRY_PROFILE=harness forge test           # 41 tests against the mocks at 0x16b and 0x167
cd workflow && bun run sim:liq
```

**On screen:** the `loc.sh` table (98 lines down to 52 per project), the `liq plan=…` log line, then
`docs/cre-evidence/challenge.md` with the `join()` transaction hash on Sepolia
(`0x22feaf45d88d5ffada8b10a55a4561e605326218d592d26d81e52e1977fe64a9`).

**Say:** the same `decide.ts` policy module runs both workflows, the bond monitor on Hedera and the liquidation
defender on Sepolia. The harness is the Hedera-specific boilerplate we had to write once and would rather nobody
wrote again: scheduled-call capacity probing, response-code decoding, and mocks for `0x16b` and `0x167` so all
of this is testable without a testnet.

A fresh `sim:liq` today prints `plan=scenario-inactive` and returns `INACTIVE`, because the challenge contract's
`onlyActive` gate is closed outside a scoring scenario. Say that: the workflow probes the gate with an
`eth_call` in the same JSON-RPC batch and declines to spend gas, which is the intervention discipline the
challenge scores. The reverted naive attempt is in
`docs/cre-evidence/liquidation-protection-20260910-1426-defend-reverted.log` if you want the contrast.

Close on the flowchart.

---

## Trim list, 3:50 → 2:00

Cut in this order; each line is independent. All of them together are 110s, which lands on 2:00.

1. Segment 7 entirely (−25s). The harness and the challenge are links in the README, not the story.
2. Segment 6's A/B table (−10s). It is in `docs/bazantic-ab/README.md` and in the written submission. If the
   gateway is still draft, cut all of segment 6 except `runUnfreeze()` (−35s).
3. Segment 4's `curl …/risk` (−10s). The same coverage number is on screen again in segment 5.
4. Segment 3's `runRejectedBuy()` script run (−15s), **only if** the `cast call` already printed decoded
   `ComplianceRejected(bytes1,bytes32)`. `cast` has no ABI for a project-local custom error and may print raw
   revert data instead; dry-run it before recording. If it prints hex, the script run *is* the decoded shot, so
   keep it, drop this item, and accept 2:15.
5. Segment 2's second `getKycStatusFor` (−10s). Say "one wallet has KYC, one does not" over a single call.
6. Segment 5's WARN relay (−20s). Show the WARN simulation, then the withdrawal, then the FREEZE simulation and
   its relay. The nonce is then 1 on screen and 2 on-chain, so say the WARN was relayed earlier rather than
   implying it was not.
7. Segment 4's `runStatus()` (−10s). Keep `validate-schedule.sh`; the schedule is the proof.

Never cut: the `ComplianceRejected` revert, the WARN and FREEZE simulations with the withdrawal between them,
the relayer submit, and the `BondNotActive` revert. Those four shots are the submission.

## Recording notes

- Hedera testnet gas swings roughly 340 to 1160 gwei with a 15M per-transaction cap, and forge scripts need
  `--slow --skip-simulation`. A broadcast takes 5 to 15 seconds. Record each segment separately and cut the
  waits rather than talking over them.
- **Any `cast send` that reaches the vault's native send or the Schedule Service needs an explicit
  `--gas-limit`**, because the relay's `eth_estimateGas` under-estimates both:
  `CollateralVault.withdraw` wants 400000, `BondLifecycle.schedule` wants 3000000 (it used 1,505,270; a 600k
  limit reverts). Without the flag the transaction lands and reverts, which is a bad take, not a bad contract.
- `forge create --json` prints a non-JSON preamble on this toolchain, so anything scripted around it must parse
  the `Deployed to:` line rather than piping to `jq`.
- Views printed by a broadcasting beat are forge's local post-transaction state, not the chain. Only
  `runStatus()` and the `cast` reads are authoritative. Do not narrate a number that came out of a broadcast
  log.
- The mirror node trails consensus by 2 to 5 seconds, so `trades` in segment 3 may lag the fill by one refresh.
  Run the fill, talk for a beat, then curl.
- The API caches reads for `CACHE_TTL_MS` (10 s). After `runUnfreeze()`, wait out the TTL before re-reading
  `/risk` or you will be served the frozen answer from cache.
- A verdict that has already been applied prints `{"skipped":"already-applied"}` rather than re-sending. If you
  rehearse the relay, expect that on the take.
- Never show `.env`, `workflow/secrets.yaml`, `cre secrets` output, or a terminal with a private key in
  scrollback. Clear the screen between segments.
- Every transaction shown should be linkable afterwards. Collect the HashScan URLs the scripts print and put
  them in the submission alongside this file; the ones already recorded are in the root `README.md`.
