# Demo script, 3:55 cut

ETHGlobal's uploader caps the video at **4:00**. This is a 3:55 cut in seven segments, driven from the hosted
app with the terminal only where the terminal *is* the evidence (the enclave simulation, the harness). The trim
list at the bottom takes it to 2:30 if the recording runs long; two beats on it are marked as never-cut because
a sponsor track requires them on screen.

Nothing here deploys anything. Deployment, bond creation, KYC and the coupon schedule all happened before
recording, so the video shows a system that is already running. Every transaction the script produces is
linkable on HashScan afterwards; the ones already recorded are in the root `README.md` storyline.

Two recordings come out of this session: the main video below, and a separate 3–5 minute Bazantic screen
recording whose shot list is in [`api/bazantic/dashboard-steps.md`](../api/bazantic/dashboard-steps.md).
Segment 6 is the short version of that recording, not a replacement for it.

## Before you hit record

```sh
cd bond-desk
source .env                     # HEDERA_PRIVATE_KEY (deployer = issuer = admin), RISK_SIGNER_KEY, COMPLIANCE_OFFICER_KEY
export HEDERA_RPC_URL=https://testnet.hashio.io/api
export API=https://wd6nrvmajt.ap-south-1.awsapprunner.com     # the app is served at the same origin: / is the front page, /desk the desk
export GATE=$(jq -r .riskGate  deployments/testnet.json)      # 0x1dFF1d5458D6a6f6af46014de76474DC3170C31B
export TOKEN=$(jq -r .token    deployments/testnet.json)      # 0x0100526434C821d0df24f6CC60352F830F8b4504
export SCHEDULE=$(jq -r .schedule deployments/testnet.json)   # coupon 3's schedule, 0.0.10482928
export BOND_ID=$(jq -r .bondId deployments/testnet.json)      # 1
```

Wallets: either MetaMask on Hedera testnet (chain 296, RPC `https://testnet.hashio.io/api`, symbol HBAR, explorer
`https://hashscan.io/testnet`) with the keys below imported and named so the connector chip reads well on camera,
or, simpler for a recording, the dev server with `?burners=1` (`cd web && npm run dev`, then
`http://localhost:5173/?burners=1` with the API on `localhost:8787`): every demo key in `web/.env.local` appears as
*Burner: investor 1, investor 2, investor 3, issuer, officer, relayer*, signs without a popup, and no installed
wallet extension (Phantom in particular) can take the session over. The hosted URL is for the judges; the burner
mode is for the take.

Three bonds are live on the desk (BDB27 daily 5%, BDB28 weekly 7.25%, BDB30 30-day 3.75%), each with its own
book quoted by the issuer and investors 1 and 2 (`README.md` step 20). The script below stays on bond #1, which
is the one the deployed enclave monitor watches; bonds 2 and 3 are there to show the desk as a desk, and their
risk status only changes by hand or through the simulator with `bondId` overridden.

| Name in MetaMask | Key | Used in |
|---|---|---|
| Issuer / admin | `HEDERA_PRIVATE_KEY` | segments 4, 5 |
| Investor 1 (KYC) | `deployments/testnet.json .wallets.investorKyc1` | segments 3, 4, 5 |
| Investor 2 (KYC) | `.wallets.investorKyc2` | quotes on all three books, not needed on camera |
| Investor 3 (no KYC) | `.wallets.investorNoKyc` | segment 3 |
| Officer | `COMPLIANCE_OFFICER_KEY` | segment 2 |
| Relayer | `relayer/.env` | segment 5 |

Pre-flight, all must pass:

```sh
cast chain-id --rpc-url "$HEDERA_RPC_URL"                                 # 296
curl -sf "$API/healthz" | jq .                                            # {"ok":true,"chainId":296,"kycDesk":true,...}
cast call "$GATE" 'snapshot(uint256)' "$BOND_ID" --rpc-url "$HEDERA_RPC_URL" | cut -c1-66   # status word must be 1 (Active)
cast call "$TOKEN" 'getKycStatusFor(address)(uint8)' "$(jq -r .wallets.investorNoKyc deployments/testnet.json)" --rpc-url "$HEDERA_RPC_URL"   # 0
(cd workflow && bun run sim:bond 2>&1 | grep -E 'Nitro|action=')          # banner names AWS Nitro; action=WARN
```

`kycDesk: true` means `COMPLIANCE_OFFICER_KEY` is set on the deployment, which segment 3's self-service beat
needs. If investor 3 has KYC from a rehearsal, revoke it from the Compliance page (officer wallet) before
recording; if the bond is `Frozen`, unfreeze it from the Risk tab (admin wallet).

Screen setup: the app in one browser window at 125% zoom, MetaMask pinned; a second window with three tabs,
the rendered `docs/architecture.md`, HashScan on `$TOKEN`, and
`https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.10482928`; one terminal at ~18pt. Clear the
terminal between segments.

---

## 1 · 0:00–0:15 · What this is

**On screen:** the app's front page at `$API/` (the live strip and the two diagrams), then *Open the desk*: three
bonds, each with a bid, an ask, depth and coverage. The flowchart in `docs/architecture.md` is the fallback if the
API is slow.

**Say:** a corporate bond issued through Hedera's Asset Tokenization Studio; an order book that asks the token's
own compliance check before every fill; coupons fired by Hedera's Schedule Service; and a Chainlink CRE enclave
that watches collateral coverage against thresholds nobody on-chain can read, and can freeze the market. Point
at the one line that matters: the enclave signs, a courier relays, because Hedera is not a CRE-supported chain.

---

## 2 · 0:15–0:45 · Issuance and configuration, through ATS · never cut

Hedera's *Tokenization of Anything* track requires issuance and configuration on screen.

**On screen, in order:**

1. HashScan, the issuance transaction: `deployBond` on the factory already deployed on testnet,
   `https://hashscan.io/testnet/transaction/0xf12ba21df080b14138f1a48adc31bb777ed192278d71f87ae98c021212bcf173`.
   Hold on the `BondDeployed` event and the token it created.
2. The terminal, the configuration block that produced it:
   ```sh
   sed -n '/BondDetailsData/,/deployBond(/p' ats/script/CreateBond.s.sol
   ```
   Point at `internalKycActivated: true`, `isControllable: true`, the regulation type (REG_S) and the `rbacs`
   array: KYC, snapshot and maturity-redeemer roles granted to our contracts and the officer at creation.
3. The app, **Compliance** page, officer wallet connected, bond token BDB27 selected in the picker: look up investor 1
   (KYC GRANTED) and investor 3 (NO KYC); the decision line is the token's own `canTransferFrom` answer.

**Say:** we did not fork ATS, we called the factory at `0xd1F118A4…78379d`. The bond carries its own KYC list,
its own freeze list and its own transfer rules; everything else in this demo has to go through them.

---

## 3 · 0:45–1:25 · Compliance is enforced by the contract, not the UI

**On screen:** the app, bond #1, **Order book** tab. The ladder has three asks and two bids from three makers;
use the issuer's 1.00 ask (10 bonds) for the fills below. Order 1 at 0.99 has 2 bonds left, so a *Buy* of 5 on
that row is refused as `BadAmount` before it is sent, which is fine to show but not the beat.

1. Connect **Investor 3 (no KYC)**. Click *Buy* on the 1.00 ask, 5 bonds, confirm in MetaMask. The app decodes the revert
   before sending: `ComplianceRejected(0x10, InvalidKycStatus)`, the token's own answer to `canTransferFrom`.
   Nothing was sent; nothing moved.
2. Stay on Investor 3, go to **Eligibility**. Click *Request testnet KYC*: MetaMask signs a one-line message
   (no gas), the API's officer bot grants KYC on the token, the tab shows the `grantKyc` hash and `canHold:
   true`.
3. Back to **Order book**, *Buy* 5 again. Two MetaMask prompts (USDC approval, then the fill), the trade
   appears in the history with its HashScan link, the ask shrinks.

**Say:** the rejection is `canTransferFrom` on the ATS token, called inside `fill`, before any transfer. The
same order fills for the same wallet the moment the token says yes. The officer bot is testnet convenience;
the check it satisfies is the token's.

The recorded version of this beat, if a take fails: rejected read at
`README.md` step 4, fill `0x07e85a43…067bd4`, self-service grants are in the **Activity** page as
`KycGranted` events.

---

## 4 · 1:25–1:55 · Collateral, and a coupon Hedera paid by itself

**On screen:** bond #1, **Collateral** tab, then **Coupons** tab.

Collateral shows the vault balance in HBAR, the live Chainlink HBAR/USD price it is valued at, and the
coverage in basis points the vault computes on-chain. No typing.

Coupons shows the latest paid coupon with its snapshot id (coupon ids restart at 1 on the redeployed lifecycle
contract; the storyline's coupon 3 is id 2 there), and the pending schedule for the next one, armed from inside
the executed call. Beside it, the terminal:

```sh
harness/scripts/validate-schedule.sh "$SCHEDULE"         # exit 0: executed_timestamp is set and the child tx SUCCEEDED
```

Connect **Investor 1**, click *Claim* on the latest coupon, confirm. The claimed amount and the HashScan link appear.

**Say:** collateral is native HBAR valued against the Chainlink feed on Hedera testnet at `0x59bC155E…c92B4a`,
and coverage is computed by the contract, not by us. The coupon was fired by Hedera's Schedule Service through
HIP-1215 `scheduleCall`; the contract is the payer; the call that executed scheduled the next one from inside
itself; and the validator checks the child transaction's result, because a schedule that executed and reverted
looks identical on the schedules endpoint. We learned that the hard way: that story is in `docs/FEEDBACK/hedera.md`.

If coupon 3 has not fired yet when you record (it is due 2026-09-12 10:14:52 UTC), show coupon 2 instead and
point at the pending schedule's `expiration_time` on the mirror-node tab.

---

## 5 · 1:55–2:50 · The confidential monitor freezes the market · never cut

The centrepiece. The coverage drop is real.

1. **Collateral** tab, **Issuer** wallet: *Withdraw* 20 HBAR, confirm. Coverage drops on screen.
2. Terminal:
   ```sh
   cd workflow && bun run sim:bond 2>&1 | tee ../docs/cre-evidence/bond-monitor-$(date +%Y%m%d-%H%M)-freeze.log; cd ..
   ```
   Point at three things: the banner naming **AWS Nitro in us-west-2**, the `[USER LOG]` line with
   `action=FREEZE reason=below-freeze` and a coverage *bucket* rather than a number, and the last line,
   `VERDICT_JSON {…}`: an EIP-712 signature made inside the handler with a key that has never touched this
   machine. The thresholds never appear anywhere.
3. Copy the `VERDICT_JSON` line. App, **Risk** tab, **Relayer** wallet: paste into *Relay a signed verdict*,
   the app verifies the signature against `RiskGate.signer()` and shows the recovered address, click *Relay*,
   confirm. The status badge flips to **Frozen**; the verdict history gains a row with the nonce.
4. **Order book**, **Investor 1**: *Buy* 5 on the same ask. The app decodes `BondNotActive(1, Frozen)`. A
   KYC'd buyer, a valid order, and the fill still fails. Bonds 2 and 3 keep trading: the freeze is per bond.
5. **Risk** tab, **Issuer / admin** wallet: *Unfreeze*, confirm. Badge back to **Active**.

**Say:** the relayer verified the signature locally before spending gas, and `RiskGate` checks the signature and
the nonce, not the sender: anyone can be the courier and nobody can forge a verdict. Compliance and risk are
separate gates and both live in the contract. An observer can check the freeze was justified by the coverage
the verdict carries without learning where the threshold sits.

If the wallet flow is too slow on the take, the terminal relay is unchanged:
`relayer/scripts/extract-verdict.sh < <log> > relayer/inbox/freeze.json && (cd relayer && npm run relayer -- submit --file inbox/freeze.json)`.
Recorded relays: [WARN](https://hashscan.io/testnet/transaction/0xe534d72b2f9ec132756dc66b63e1476b05a50d13f8613b69a327ac6e085dd7b6),
[FREEZE](https://hashscan.io/testnet/transaction/0x18d46f9627d0e7808d2c78d73848c5aefd813d73147bd19abc74c8e0573db14e),
and the enclave delivering a verdict itself with no relayer, `deliver: "direct"`,
[`0x681cb6a2…f2bb95b`](https://hashscan.io/testnet/transaction/0x681cb6a29fd3b39144d3e799090fa2c25efcb1376760943f2cf7edb66f2bb95b).

Put the 20 HBAR back (**Collateral**, *Deposit*) after the take so the next rehearsal starts from the same
coverage.

---

## 6 · 2:50–3:20 · The same desk is an agent-payable product

```sh
curl -i https://axuvor5zujgk5hdcydzjdi742m.bazgateway.com/bonds | head -12     # 402 + x402 challenge, $0.005 in USDC
```

**On screen next:** the Bazantic Recipe *Best Eligible Hedera Bond Recommendation*
(<https://bazantic.com/recipes/best-eligible-hedera-bond-recommendation>) run against Investor 1's address from
the dashboard: the tool-call list shows the Hedera Mirror Node (testnet) gateway, the Bond Desk gateway and the
Bank of Canada Valet gateway being called in one flow, and the answer names the bond, its yield, its coverage,
the wallet's last transaction and a HashScan link.

**Say:** the API judges can open in a browser is the same one an agent pays per call for. The Recipe chains
three gateways, two of which did not exist before this week; the full run, and the A/B that measures what the
Recipe adds, are in the separate Bazantic recording.

---

## 7 · 3:20–3:55 · The harness, and the Chainlink challenge · never cut

Hedera's *Improve the Harness* track requires the improvement working on screen.

```sh
FOUNDRY_PROFILE=harness forge test                          # 42 passed: mocks at 0x16b and 0x167, the probe loop, the timestamp lag
harness/scripts/doctor.sh                                   # 8/8 PASS against testnet
harness/scripts/validate-schedule.sh 0.0.10482965           # the harness's own template contract: executed, child SUCCESS, exit 0
harness/scripts/loc.sh                                      # 98 lines down to 52 per project
cd workflow && bun run sim:liq 2>&1 | grep -E 'Nitro|plan='  # plan=scenario-inactive: the gate is closed, no gas spent
```

**On screen:** the four terminal outputs, then `docs/cre-evidence/challenge.md` with the Sepolia `join()`
transaction (`0x22feaf45…64a9`), then the terminal: `cre workflow list --registry private` (two ACTIVE workflows) and
`cre execution list liquidation-protection-production` (a `SUCCESS` row every 30 s from the CRE network).

**Say:** the harness is the Hedera boilerplate we had to write once, a Foundry base that fires due schedules,
mocks for both system contracts, and validators that treat the mirror node as the authority, including the
check that a scheduled call's child transaction actually succeeded. The same `decide.ts` policy module runs the
bond monitor on Hedera and the liquidation defender on Sepolia; the defender probes the challenge contract's
gate inside its read batch and declines to spend gas outside a scoring window.

Close on the flowchart.

---

## Trim list, 3:55 → 2:30

Cut in this order; each line is independent.

1. Segment 6's Recipe run (−20s). Keep the 402. The run is in the Bazantic recording.
2. Segment 4's *Claim* (−10s). The coupon and the validator are the shot.
3. Segment 5's step 1 withdrawal (−15s), **only if** the current coverage already yields `FREEZE` in a
   rehearsal run; otherwise the withdrawal is what makes the verdict real.
4. Segment 3's step 2, self-service KYC (−20s). Then say "the officer granted KYC off camera" and use
   Investor 1 for step 3.
5. Segment 2's terminal shot of `CreateBond.s.sol` (−10s), keeping the issuance transaction and the
   Compliance page. Configuration must stay on screen in one of the two.
6. Segment 7's `loc.sh` and `sim:liq` (−10s). Keep `forge test`, `doctor.sh` and `validate-schedule.sh`.

Never cut: segment 2's issuance transaction, segment 3's decoded `ComplianceRejected`, segment 5 end to end
(withdrawal, simulation, relay, `BondNotActive`, unfreeze), and segment 7's harness tests. Those are the
track requirements and the submission.

## Recording notes

- Hedera testnet gas swings roughly 340 to 1160 gwei with a 15M per-transaction cap; a transaction lands in 5 to
  15 seconds. Record each segment separately and cut the waits rather than talking over them.
- The app passes explicit gas limits for the two calls the relay under-estimates (`CollateralVault.withdraw`,
  `BondLifecycle.schedule`), so MetaMask shows the right number; do not lower it in the wallet.
- The mirror node trails consensus by 2 to 5 seconds and the API caches reads for 10 s (the order book for 3 s).
  After a transaction, talk for a beat before pointing at a table.
- The Risk tab refuses a verdict whose nonce is not `lastNonce + 1`, so a verdict from a rehearsal cannot be
  replayed on the take. Re-run `sim:bond` for a fresh one, and relay it within the same hour: the deployed
  bond-monitor fires at the top of every hour and takes the next nonce itself. It watches bond 1 only
  (`workflow/bond-monitor/config.production.json`); nonces are per bond, so bonds 2 and 3 start at nonce 1.
- Never show `.env`, `workflow/.env`, `workflow/*/secrets.yaml`, `cre secrets` output, or a terminal with a
  private key in scrollback.
- Every transaction shown should be linkable afterwards. The **Activity** page lists them newest first with
  HashScan links; collect the ones from the take and put them in the submission alongside this file.
