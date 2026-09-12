# Design notes and known limits

## Why a relay, and what stays private

Hedera is not a CRE-supported chain. There is no chain writer, no EVM client target, and no on-chain report
consumer for chain 296, and `EVMClient` has no `TeeRuntime` overload at all. So the workflow reads Hedera as raw
JSON-RPC over the CRE HTTP client (one `eth_call` to `RiskGate.snapshot(bondId)`, batched into a single HTTP
request to stay inside the 5-calls-per-execution budget) and writes nothing itself. It signs an EIP-712
`Verdict(uint256 bondId,uint8 action,uint256 coverageObserved,uint64 issuedAt,uint64 nonce)` with a key that
exists only as a CRE secret and is only ever materialised inside the enclave, and emits the verdict plus the
signature as one log line.

That signature is the trust boundary. `RiskGate.submit` recovers the signer, compares it to `signer()`, checks
`nonce > lastNonce` (strictly increasing) and an `issuedAt` freshness window, and does not care who sent the
transaction. The workflow always signs `lastNonce + 1`, but the contract only requires the nonce to increase, so
a verdict can never be replayed and a verdict that was signed and never relayed does not wedge the gate. The
relayer is therefore a courier: it holds a funded Hedera key that can pay gas and nothing else, anyone can run
one, and losing its key delays verdicts rather than forging them.

| Never leaves the enclave | Public, on-chain or in logs |
|---|---|
| the verdict signer key, and the submit key in direct mode | the signer's address, via `RiskGate.signer()` |
| the coverage thresholds that define WARN / FREEZE / DEFAULT | the `action` that resulted |
| the liquidation policy: trigger and target health factors, repay and deposit caps, cooldown | the repay and deposit transactions themselves |
| the exact coverage in the workflow's own log line, which is bucketed to `>=150%` / `120-150%` / `100-120%` / `<100%` | `coverageObserved` in the verdict, because the contract needs it to be auditable |

The private policy values live in `workflow/.env` and are shipped to CRE as secrets (`workflow/*/secrets.yaml`
maps secret ids to env var names, never values). They are not in this repository, and the committed simulation
logs were checked with a word-boundary match of every `.env` value of 4 or more characters: nothing the
workflows write matches — no `[USER LOG]` line, no `VERDICT_JSON` field, and none of the private keys. Both
policies were rotated on 2026-09-12 after the 09-10 runs, so nothing in the committed 09-10 logs describes the
live policy, and the check now reports no hit across all logs. The check is in
[`docs/cre-evidence/README.md`](../docs/cre-evidence/README.md).

## Known limits

- **The signature is not enclave-attested.** CRE has no enclave-held signing primitive, so the verdict proves
  the key was used, not that a genuine TEE used it. This is not fixable from user code; see
  [`docs/FEEDBACK/chainlink.md`](../docs/FEEDBACK/chainlink.md).
- **DEFAULT is a coverage floor, or an admin action.** Workflow runs are stateless, so "the coupon has been late
  for N days" has nowhere to live. DEFAULT fires below a floor threshold (disabled in the demo policy); a real
  deployment keeps missed-payment state on-chain.
- **WARN repeats on every run** by design: it is a signal, not a state change. Only FREEZE and DEFAULT are
  suppressed when the bond is already in that state.
- **hashio is a dev endpoint.** `eth_getLogs` caps at 7 days / 1000 blocks, so all history comes from the mirror
  node, which trails consensus by 2 to 5 seconds.
- **The relay under-estimates gas for native-value sends and for system-contract calls.** `eth_estimateGas`
  returns too little for a contract call that forwards HBAR, so `CollateralVault.withdraw` needs an explicit
  `--gas-limit` (400000 works), and `BondLifecycle.schedule` reaches `0x16b` and used 1,505,270 gas, so it needs
  `--gas-limit 3000000` (600k reverts). The deploy and demo scripts run with `--skip-simulation` so gas comes
  from the relay rather than forge's local EVM.
- **A scheduled call's gas budget has to cover what the call itself schedules.** The first coupon schedule
  executed on time and reverted out of gas at `SCHEDULE_GAS = 2_000_000`, because `payCoupon` also re-schedules
  the next coupon. It is now 4,000,000 with headroom, but there is no way to learn the real figure other than
  running it on testnet: the failure is only visible on the mirror node's transactions endpoint, and
  `/contracts/results/{id}` returns the original `schedule()` call instead. See
  [`docs/FEEDBACK/hedera.md`](../docs/FEEDBACK/hedera.md).
- **The liquidation challenge contract only accepts actions while a scenario is active.** `repay` and `deposit`
  revert with `Scenario has not started` outside a scoring window, so `liquidation-protection` probes the gate
  with an in-batch `eth_call` and returns `INACTIVE` rather than burning gas. Evidence for both the reverted
  attempt and the probe is in [`docs/cre-evidence/`](../docs/cre-evidence).
- **Demo thresholds are scaled to faucet-sized collateral.** 100 HBAR against a 100-bond issue gives coverage in
  the hundreds of bps, so the demo policy sits far below anything a real bond would use. The ladder is the same;
  only the numbers are small.
- **Bazantic is dashboard-first.** Pricing, activation and Recipe editing are dashboard-only in CLI 0.8.0, so the
  gateway prices and the Recipe's bindings are documented in [`api/bazantic/`](../api/bazantic) rather than applied
  from the repo; the Bank of Canada Valet operations sit at the platform default $0.01 because the spec's price
  extension is not read at registration; the marketplace listing of the Bond Desk gateway awaits Bazantic's
  verification, which is on their side; and the benchmark curve is CAD against a USD-settled testnet bond, a
  relative-value sanity check rather than a hedgeable spread. The A/B run in
  [`docs/bazantic-ab/README.md`](../docs/bazantic-ab/README.md) calls the public API directly in both arms, so its
  x402 spend is `0` by design rather than by omission.
- **Deployed on the CRE network on 2026-09-12, a day before the deadline.** Deploy access was enabled that morning;
  both workflows are on the private registry (`liquidation-protection-production` `00cdbaa2…48554f`, every
  30 s; `bond-monitor-production` `0045bd36…5c96c8`, hourly, delivering its own verdicts to Hedera) and the
  record is [`docs/cre-evidence/deployed-20260912.txt`](../docs/cre-evidence/deployed-20260912.txt). What the CLI
  does not show is whether the network ran the handler inside the Nitro enclave the constraint asks for
  (`cre execution events` lists only the trigger and the HTTP batch), and the Confidential Workflows
  early-access form was never confirmed, so the attested-execution evidence is the simulator runs in
  `docs/cre-evidence/*20260912*`, whose banner names the enclave. [`workflow/scripts/defend-loop.sh`](../workflow/scripts/defend-loop.sh)
  stays armed as the backup for the scoring window. The Sepolia `join()` and the position it created are live
  regardless.
- **Logs from a deployed confidential handler are visible, once per node.** The simulator banner says they never
  leave the TEE; `cre execution logs` returns them from every DON node. Nothing we log is sensitive (a coverage
  bucket, a plan word), and the deployed bond-monitor delivers its own verdict (`deliver: "direct"` in
  `workflow/bond-monitor/config.production.json`, hourly) rather than relying on a log-line relay; the relayer
  remains the courier for simulator-produced verdicts and for re-submitting a signed verdict from a log.
- **EVM wallets only, and one that behaves.** The app needs an EIP-1193 wallet on Hedera testnet (chain 296);
  HashPack is not one. Every wallet that announces itself over EIP-6963 is listed by name; the generic
  `window.ethereum` entry appears only when none does. Phantom's EVM provider claims to be MetaMask,
  auto-connects to origins it has authorised and re-fires `accountsChanged` after a disconnect, so it can take a
  session over; pick MetaMask by name, or in development open `?burners=1`, which ignores wallet extensions and
  offers the demo keys from `web/.env.local`.
- **One process, one cache.** The API caches reads for 10 s in memory. It is a demo service, not an HA
  deployment.
- **The relayer inbox is gitignored.** `relayer/inbox/*.json` and every `.env` are excluded, so the extracted
  verdict files are not in the tree; both relayed verdicts are reproducible from the logs in
  [`docs/cre-evidence/`](../docs/cre-evidence) with `relayer/scripts/extract-verdict.sh`.

The rest are contract behaviours as deployed. They are documented rather than changed, so the Sourcify
exact-match verification above stays valid (the lifecycle instance at `0xeB363F5a…4255C956` differs from the
previous one only by `SCHEDULE_LAG`):

- **`BondLifecycle.schedule()` reverts `AlreadyScheduled` on a stale pointer.** A scheduled run that executed and
  then reverted leaves `scheduleOf` set and `scheduledFor == nextCoupon`, so the permissionless re-schedule
  refuses even though nothing is armed. Recovery is a manual `payCoupon`, which clears the pointer and re-arms
  the chain. A future version compares against the actual scheduled second instead of `nextCoupon`.
- **Redeem before the final coupon.** The first `redeem()` sets `Matured` and `payCoupon` rejects `Matured`, so
  any coupon still due at maturity has to be paid (`payCoupon`) before holders redeem. The demo terms leave no
  coupon due at maturity.
- **Seized collateral is shared pro-rata across the whole snapshot supply**, including the issuer's unsold
  inventory. A production version would exclude the issuer's own balance.
- **The settlement pool has no withdrawal path.** Over-funding, dust and unclaimable amounts stay in
  `BondLifecycle`; only the HBAR payer float is recoverable (`withdrawHbar`).
- **`BondMarket.quote()` scans every order id ever placed.** Enough spam orders push it past the relay's
  `eth_call` gas cap. That is an order-book read only, so funds are unaffected. A per-bond index, or an
  event-based off-chain book, is the upgrade.
- **Four smaller ones.** `schedule()` has no status or maturity guard, so anyone can make an exhausted bond burn
  one HSS run that reverts; `cost()` floors in the buyer's favour for bonds with `decimals > 0` (the demo bond
  has 0 decimals); a DEFAULT verdict cannot land while the ATS token is paused, because `takeSnapshot` is
  `onlyUnpaused`; and a fill against your own order is not rejected.
- **The demo ISIN `US0378331005` was chosen only because the ATS factory validates the checksum.** It belongs to
  a real listed equity and is not an issuance of that company. Testnet demo data.

