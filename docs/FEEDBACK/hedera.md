# Feedback — Hedera

Written while building Bond Desk (ATS bond + order book + HIP-1215 scheduled coupons + Chainlink feeds) on
Hedera testnet, Sept 2026, then revised after the testnet deployment on 2026-09-10. Findings below were hit for
real unless marked **[to confirm]**.

## HIP-1215 / HSS `0x16b`: the payer rule needs to be the first sentence

`scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes callData)` charges the
**calling contract** for the future execution. That single fact determines your entire contract design — the
scheduling contract must hold HBAR, must have a `receive() payable`, needs a funding path, and needs a way to
withdraw the float when the schedule is cancelled. That last one is not hypothetical: when we had to redeploy
the contract we recovered its float with an admin `withdrawHbar` and funded the replacement, and without that
path the HBAR would have been stranded in a superseded payer. We found the payer rule by reading the HIP
carefully rather than from the top of the docs page, and it is the difference between a working coupon and a
contract that silently schedules nothing. Put it in the first paragraph of the `scheduleCall` reference, with a
worked "fund the payer" example.

Related, and just as surprising: **`scheduleCall` never reverts.** It returns `(int64 responseCode, address
scheduleAddress)`. Code `370 SCHEDULE_EXPIRY_IS_BUSY` is a normal, expected outcome at any popular second, not
an error condition — which means every production caller needs a probe-and-retry loop around
`hasScheduleCapacity`. That loop is not trivial to get right (back-off base, jitter source, how many probes,
what to do when `block.prevrandao` is 0 on a given network). We wrote one
(`harness/src/HederaHarness.sol: findAvailableSecond` / `scheduleWithProbe`) and would rather it had been a
copyable snippet in the docs. Every team that ships a scheduled call will write this function; it should exist
once.

Also worth documenting explicitly, and precisely: `373 NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION` exists
as a response code, and we designed defensively around it (a permissionless `schedule()` anyone can poke)
because the obvious "each coupon schedules its successor" design looked like it would trip it. On testnet it
does not: our HSS-executed `payCoupon` scheduled the next coupon from inside itself and got `SUCCESS`, creating
schedule `0.0.10457462`. So the constraint is narrower than the code name suggests, and we could not tell from
the documentation what the actual boundary is: one level of nesting, or a depth limit, or something about the
payer. Say exactly when 373 is returned. Teams are currently either designing around a constraint that does not
apply to them, or walking into one they did not know about, and both are guesses.

## A scheduled call's gas budget has to cover what the call itself schedules, and the failure is hard to find

The best bug of the build, and one sentence of documentation prevents it.

Our first coupon schedule executed exactly on time: `GET /api/v1/schedules/0.0.10456917` came back with
`executed_timestamp: 1789035282.045161279`. But no coupon was paid. `couponCount` stayed 0 and the contract
looked broken. The scheduled call had reverted with `CONTRACT_REVERT_EXECUTED`, out of gas: `SCHEDULE_GAS` was
2,000,000, and `payCoupon` against the real ATS token *plus the nested `scheduleCall` for the next coupon*
estimates at about 1.84M by `eth_estimateGas` before the system contract's own markup. For scale, the plain
`schedule()` entry point used 1,505,270 gas on its own. Raising the budget to 4,000,000 fixed it and the next
attempt paid the coupon and re-scheduled itself; `hasScheduleCapacity` accepts at least 12M on testnet, so
headroom is cheap and there is no reason to be tight.

Two separate asks, and the second one is the expensive part:

1. **Say in the `scheduleCall` reference that the gas limit must cover everything the scheduled call does,
   including any `scheduleCall` it makes itself, plus a markup.** Right now a developer sizes the gas against
   the function they are scheduling, which is the wrong number by roughly the cost of a second schedule. Suggest
   generously, or expose the markup.
2. **Make a failed scheduled execution discoverable.** This is the real cost. A schedule that executed and
   reverted is indistinguishable, from the schedules endpoint, from one that executed and succeeded:
   `executed_timestamp` is set either way, and there is no status field. `GET /api/v1/contracts/results/{txid}`
   is the obvious next place to look and it returns the **original** `schedule()` call, not the scheduled
   execution, so it reports success and sends you looking for a bug in your contract. The only way we found the
   revert was `GET /api/v1/transactions?timestamp=<executed_timestamp>`, where the scheduled child transaction
   appears with `result: CONTRACT_REVERT_EXECUTED` and `scheduled: true`.

   Adding the child transaction's result to the schedules endpoint, or a link to it, would turn a multi-hour
   investigation into one field. HashScan's schedule page has the same gap: it shows the schedule executed and
   does not show that the execution failed. For anything built on HIP-1215 this is the single most important
   piece of observability, because a silent revert inside a scheduled call is exactly the failure mode the
   feature invites.

## `block.timestamp` inside a scheduled execution is the block's start, not the expiry second

The second coupon found this one, and it is the kind of bug that passes every local test. `payCoupon` scheduled
its successor at exactly `nextCoupon` (`1789121682`) from inside the first coupon's execution, and HSS did what it
promised: schedule `0.0.10457462` has `expiration_time: 1789121682.000000000` and
`executed_timestamp: 1789121682.025689368`. The execution reverted anyway, `CONTRACT_REVERT_EXECUTED`, fee
5,405,196 tinybar, far too cheap to have reached the snapshot. The reason is in the block record: the execution is
the last of 43 transactions in block `40378969`, whose `timestamp.from` is `1789121680.007748104` and
`timestamp.to` is `1789121682.025689368`. Hedera blocks are ~2 s windows of consensus time, and `block.timestamp`
as the EVM sees it is the *start* of the window, so the call saw `1789121680`, two seconds before the second it was
scheduled for, and the guard `block.timestamp < nextCoupon` fired. Coupon 1 only survived because its target was
already in the past when it was re-armed by hand at `now + 5`: it executed at `1789035662.019503208` in block
`40338609` (`timestamp.from 1789035661.647882104`), which is comfortably after its `nextCoupon` of `1789035282`.
Same code path, one accidental pass, one deterministic failure.

The fix is one constant: schedule at `target + 10` (`BondLifecycle.SCHEDULE_LAG`), keep `scheduledFor` at the
target, and reproduce the gap in the harness (`HederaTest.executeLagged(sched, 2)` fires a mock schedule at its
second inside a block that started 2 s earlier). Two asks:

1. **State it in the `scheduleCall` / HIP-1215 reference**: the call runs at the expiry second, but the
   `block.timestamp` it observes is the enclosing block's first consensus timestamp and can be up to a block
   (~2 s) earlier. Anything gated on `block.timestamp >= expirySecond` needs a margin. Every coupon, vesting or
   auction contract will have exactly this guard.
2. **Show the block on the schedule.** Neither `GET /api/v1/schedules/{id}` nor HashScan's schedule page says
   which block the execution landed in; we had to ask `GET /api/v1/blocks?timestamp=lte:<executed_timestamp>`.

### A scheduled execution is invisible to `/contracts/results`, in both forms

This is the second time the observability of scheduled executions cost us a night, and this time we tried every
endpoint. With the scheduled child's transaction id `0.0.7314364-1789035654-697746300`:

- `GET /api/v1/contracts/results/{id}` returns the **original** `schedule()` call (`SUCCESS`, `gas_used 1505270`,
  hash `0xe00bea9a…`), which is the wrong transaction and reports success.
- `GET /api/v1/contracts/results/{id}?scheduled=true` returns a body in which **every field is `null`**: `result`,
  `block_number`, `timestamp`, `gas_used`, `from`, `to`, `hash`. Not a 404, a null record.
- `GET /api/v1/contracts/{lifecycle}/results?timestamp=gte:…&timestamp=lte:…` over the execution's second lists
  nothing at all; the contract's own results feed does not contain its scheduled executions.
- Only `GET /api/v1/transactions?timestamp=1789121682.025689368` shows the child:
  `{name: CONTRACTCALL, result: CONTRACT_REVERT_EXECUTED, scheduled: true, charged_tx_fee: 5405196}`. No revert
  data, no gas used, no block number.

So a reverted scheduled call has no revert reason anywhere and no contract-result record; root-causing it means
reading the block boundaries and the contract's guards by hand. The ask from the gas-budget section stands and is
now stronger: give scheduled executions a contract-result record, with `error_message` and `gas_used`, and link it
from the schedule.

### Recovery, and what it cost

The reverted run left `scheduleOf` pointing at an executed schedule, so the permissionless `schedule()` refused
with `AlreadyScheduled`, and the old contract would have re-armed the same exact second anyway. Recovery was a
redeploy with `SCHEDULE_LAG`, re-granting `GATE_ROLE`, `ROLE_SNAPSHOT` and `ROLE_MATURITY_REDEEMER`, recovering the
18.02 HBAR float from the superseded payer with `withdrawHbar`, funding the new one, and paying coupon 2 by hand
(`payCoupon(1)`, 1,678,160 gas at a 4M limit), which armed coupon 3 as schedule `0.0.10482928` with
`expiration_time 1789208092`, the target `1789208082` plus the lag. Receipts are in the root `README.md`.

One more relay observation from the same evening, hit for real: `eth_estimateGas` right after a state change can
be computed against the *previous* state. Nine seconds after the compliance officer's `setAddressFrozen(inv2, true)`
landed, the relay estimated the unfreeze at 80,554 gas (and `eth_call isFrozen` still answered `false`); on chain
the unfreeze ran out of gas at 80,019 and reverted, and the retry with `--gas-limit 300000` succeeded. The rule we
now follow is: after any state change you are about to depend on, pass an explicit gas limit or wait for the
mirror node to catch up.

## `eth_estimateGas` on the relay under-estimates native-value sends and system-contract calls

This one cost us a reverted transaction on camera-day. `CollateralVault.withdraw` transfers HBAR out of the
contract to the caller. Calling it with `cast send` and no explicit gas limit produced a transaction that landed
and reverted; the same call with `--gas-limit 400000` succeeded, and nothing else changed:

```sh
cast send <vault> 'withdraw(uint256,uint256)' 1 2000000000 \
  --private-key "$KEY" --gas-limit 400000 --rpc-url https://testnet.hashio.io/api
```

The relay's estimate does not account for the cost of the value transfer the contract performs, so any function
that forwards HBAR is under-estimated. Two asks:

1. Say so in the JSON-RPC relay documentation, next to `eth_estimateGas`, with the recommendation to pass an
   explicit gas limit for any call that moves native value out of a contract. Right now the failure looks like a
   contract bug.
2. Better, fix the estimate. A one-line under-estimate turns into a reverted transaction with a consumed fee,
   which is the worst possible way for a developer to learn about it.

A call that reaches a **system contract** is under-estimated the same way. `BondLifecycle.schedule`, which
calls `scheduleCall` on `0x16b`, used 1,505,270 gas and reverts at a 600k limit; we pass `--gas-limit 3000000`.
So the rule a developer needs is broader than native value: take what the relay gives you, then override it for
anything that moves HBAR or touches `0x16b` / `0x167`.

The same asymmetry bites `forge script`: the deploy and demo scripts pass `--skip-simulation` so gas comes from
the relay rather than forge's local EVM, and then the explicit gas limit has to come back for the native-value
paths. A "gas estimation on Hedera" page covering both would be genuinely useful. A smaller papercut in the same
area: `forge create --json` emits a non-JSON preamble on the current toolchain, so any script that captures a
deployed address has to parse the `Deployed to:` line instead of piping to `jq`.

## `forge script` cannot touch a system contract without `vm.etch` plus `--skip-simulation`

`eth_getCode(0x16b)` returns `0x` through the relay, and forge's local EVM has no code there either. So a script
that calls `scheduleCall`, directly or through a contract, reverts locally during the pre-broadcast run and
during the on-chain simulation replay, and **nothing is ever sent**. There is no error that names the cause.

The working recipe, which took a while to assemble and which every team scheduling a call from Foundry will
need:

```solidity
vm.etch(address(HederaHarness.HSS), type(MockHSS).runtimeCode);  // before vm.startBroadcast; never reaches the chain
```

```sh
forge script … --rpc-url hedera --broadcast --slow --skip-simulation
```

`--skip-simulation` is mandatory, not an optimisation. The consequence worth documenting alongside it: anything
the script *reads back* from `0x16b` afterwards is the mock's answer, so the real schedule address has to come
from the receipt (or from a follow-up on-chain read, which is what our `Deploy.s.sol --sig 'patchSchedule()'`
step does). A short "using Foundry with Hedera system contracts" page with exactly these three facts would save
each team most of a day. This is also the single strongest argument for shipping mocks for `0x16b` and `0x167`
as a supported artifact rather than leaving every team to write their own.

## `hashgraph/hedera-smart-contracts` import paths 404

The system-contract interfaces moved to npm `@hiero-ledger/hiero-contracts` (we pinned `0.2.0`:
`schedule-service/IHRC1215.sol`, `token-service/IHederaTokenService.sol`, `common/HederaResponseCodes.sol`). A
large amount of live documentation, blog content and starter repos still import from the old GitHub paths, which
now return 404 — including material a newcomer will find first. A deprecation notice at the old location and a
one-line "this package moved" banner in the docs would remove an entire class of first-hour failure. A note on
the `int64` vs `int32` response-code types across the two system contracts would help too; they are not
consistent and both compile.

## `eth_getLogs` on hashio caps at 7 days / 1000 blocks

Any dapp that shows history hits this. hashio returns `-32004` and the fix is to read
`GET /api/v1/contracts/{addr}/results/logs?topic0=…&order=desc&limit=…` from the mirror node instead. That is
the right answer — the mirror node is the log store — but nothing in the JSON-RPC relay documentation says so at
the point of failure. Two improvements, in order of value:

1. Make the `-32004` error message name the mirror node and the equivalent endpoint. An error that tells you
   where to go instead is worth ten pages of docs.
2. Add a "reading history on Hedera" page that states the split plainly: current state via `eth_call` on the
   relay, history via the mirror node, and never assume an EVM indexer's `eth_getLogs` habits carry over.

The consequence for portability is real: an EVM dapp ported to Hedera will appear to work and then show an empty
trade history in production, because dev-time ranges are short.

## ATS: the integration surface is hard to extract

Building against the Asset Tokenization Studio factory already deployed on testnet was the right call — no fork,
no redeploy — but assembling the integration surface took most of a day:

- There is **no published ABI/artifact package** for the deployed contracts. We hand-wrote ABI-exact interfaces
  from a pinned repo commit and vendored them (`ats/src/`), recording provenance paths in `ats/README.md`. A
  versioned `@hashgraph/ats-abi` npm package containing just the facet ABIs and the role constants would remove
  this entirely.
- Role constants live in `contracts/constants/roles.sol` as raw `bytes32` literals; deployed addresses live in a
  **dated JSON file** under `contracts/deployments/hedera-testnet/`, and different docs pages cite different
  factory/BLR addresses. We ended up guarding every address with an `eth_getCode` length check before use, which
  is good practice but should not be necessary to find out which deployment is current. One canonical "current
  testnet addresses" page, dated, would fix it.
- `deployBond` reverts with `WrongISINChecksum` if the ISIN fails its check digit. Correct behaviour, but the
  factory documentation does not mention it, and the failure looks like a malformed-struct problem. One line in
  the `ERC20MetadataInfo` docs saves an hour.
- The facet split means the ABI you need is spread across compliance, KYC, freeze, pause, snapshot, access
  control and ERC-20 facets, with no single "here is what an integrator calls" document. The seven-line table we
  ended up writing for ourselves would be a good docs page.

### Two ordering rules in issuance that are not written down anywhere

Both cost a failed transaction against the live factory before we found them by reading the facets:

- **`grantKyc` requires the issuer address to already be in the SSI list.** The last argument of
  `grantKyc(account, vcId, validFrom, validTo, issuer)` is not free-form: that `issuer` must have been added
  through `addIssuer` (which needs `ROLE_SSI_MANAGER`) first, or the call reverts. So the real sequence is
  `addIssuer(issuer)` → `grantKyc(...)`, and a newly deployed bond whose `rbacs` include a KYC manager still
  cannot grant KYC until `addIssuer` has run. Nothing in the KYC facet documentation mentions the dependency,
  and the revert does not point at the SSI list.
- **`mint` requires a KYC'd recipient.** Minting to the issuer's own address fails until the issuer has been
  granted KYC, which is surprising the first time: the issuer feels like it should be exempt from its own
  compliance rules. So the full ordering is `addIssuer` → `grantKyc(issuer)` → `grantKyc(each investor)` →
  `mint(issuer, supply)`.

Together those two rules mean the "deploy a bond and mint the supply" path is five transactions in a specific
order, none of which is stated in the factory documentation. One worked example script, in any language, would
remove the entire class of failure. Our version is `ats/script/CreateBond.s.sol` and the transactions are linked
in the root `README.md`.

**[resolved on testnet]** the operator address (our `BondMarket`) does **not** need KYC to move tokens via
`transferFrom`. `canTransferFrom` checks `from` and `to` only, and the allowance branch is the operator's only
constraint. Confirmed against live testnet state in
`contracts/test/fork/AtsFork.t.sol::test_fork_marketNotKycd_stillPassesOperatorCheck`, and confirmed again by
the fills in the deployed demo, where the market holds no KYC. Please say this explicitly in the compliance
documentation. It is the first question every order-book integrator will ask, and the safe-looking answer
("grant KYC to the market") quietly makes the market itself a holder.

## Gas, tooling and faucet

Testnet gas prices swing roughly 340–1160 gwei with a 15M per-transaction cap. Foundry scripts need
`--legacy --slow` to land reliably, and a multi-contract deploy needs a genuinely large HBAR balance — several
hundred HBAR once you include a contract funded as an HSS payer. The anonymous faucet's 100 HBAR/24h does not
cover a demo with an issuer, a compliance officer, three investors, a relayer and a funded scheduling contract;
we needed the portal account's 1000/24h. One concrete number for that worked example: creating a single ATS
bond (`deployBond` plus `addIssuer`, three `grantKyc` calls and a `mint`) came in at an estimated 30.02 HBAR at
2340 gwei, before the six desk contracts, the roles, the HSS float and the demo. A "budgeting gas for a full
deploy" note, plus a clear pointer to the higher faucet limit before people burn a day at 100/24h, would help
hackathon teams specifically.

Small but repeated papercut: `msg.value` on the Hedera EVM is denominated in **tinybar** (1e8), not 18-decimal
wei, while `cast balance --ether` and viem's `hederaTestnet` chain treat HBAR as 18 decimals. Mixing the two is
a factor-of-1e10 bug that unit tests with mocks will not catch. We assert the denomination at deploy time. A
prominent "units on Hedera" table — tinybar in contracts, weibar over JSON-RPC, the 1e10 conversion — would be
one of the highest-value pages in the docs.

**[resolved on testnet]** contract verification works on the first try with the Sourcify default:

```sh
forge verify-contract <addr> contracts/src/RiskGate.sol:RiskGate \
  --chain-id 296 --verifier sourcify --verifier-url https://sourcify.dev/server \
  --constructor-args <abi-encoded>
```

All seven contracts we deployed came back `exact_match` and show as verified on HashScan; the
`https://server-verify.hashscan.io` fallback was never needed. Two small things would still help. First, say in
the Hedera docs that Sourcify is the working path for 296 and that HashScan reads from it, because right now a
team has to guess between two verifier URLs. Second, `forge verify-contract` needs ABI-encoded constructor args
and nothing on the Hedera side hints at that, so a "verify your contract" snippet that includes
`cast abi-encode` would be the whole answer in five lines. We ended up writing the constructor args into the
deployment artifact at deploy time so that verification is a re-runnable script
(`contracts/script/verify.sh`), which is a pattern worth recommending.

## What worked well, and is worth keeping

The mirror node is excellent and underused in EVM-shaped documentation. `GET /api/v1/schedules/{id}` returned
each of our schedules within seconds of its creating transaction, and `executed_timestamp` flipped from `null`
to a consensus timestamp at exactly the second we asked for (`0.0.10457460` at `1789035662.019503208`, five
seconds after it was created). A one-line poll on that field is an authoritative, trivially scriptable proof
that a scheduled call ran, which is exactly the artifact a judge or an auditor wants, and it is why
`harness/scripts/validate-schedule.sh` is nine lines rather than an indexer. The caveat above stands: it proves
the call *ran*, not that it *succeeded*. Chainlink feeds on testnet behave as
plain `AggregatorV3Interface` with no Hedera-specific wrapper, which made the NAV/collateral path portable
EVM code. And `forge script --broadcast --rpc-url` against hashio works, which is the single biggest reason a
Solidity team can ship here in a week.

## Filed upstream (2026-09-12)

- Asset Tokenization Studio: [#1402](https://github.com/hashgraph/asset-tokenization-studio/issues/1402)
  `deployed-addresses.md` still lists the v4.0.0 testnet factory `0.0.7708432` while the current v8 factory is
  `0.0.9213391` / `0xd1F1…379d`; [#1403](https://github.com/hashgraph/asset-tokenization-studio/issues/1403)
  `mint` needs a KYC-granted recipient, the issuer minting to itself included, and only the web-app guide says so;
  [#1404](https://github.com/hashgraph/asset-tokenization-studio/issues/1404) the `transferFrom` operator is never
  KYC-checked (only `from` and `to` are), so market and escrow contracts must not be granted KYC; and the
  `addIssuer → grantKyc` ordering above was already reported as
  [#1390](https://github.com/hashgraph/asset-tokenization-studio/issues/1390#issuecomment-5644153422), where we
  added the confirmation instead of a duplicate.
- Hedera Harness: [hedera-dev/hedera-harness#62](https://github.com/hedera-dev/hedera-harness/pull/62), the
  scheduled-transaction result check described in the schedule section above.


## `setAddressFrozen` is reflected by `isInControlList`, not `isFrozen` (ATS v8 testnet build)

Observed 2026-09-12 on token `0x0100526434C821d0df24f6CC60352F830F8b4504`: after the freeze manager called
`setAddressFrozen(account, true)` (tx `0x9a5f6677…0d022d`), `isFrozen(account)` still returned `false`, while
`isInControlList(account)` returned `true` and `canTransferFrom(issuer, account, 1, "")` answered
`(false, 0x10, AccountIsBlocked)`. After `setAddressFrozen(account, false)` (`0xc9d2ad6c…9bff25`) the control-list
flag cleared and the probe returned `(true, 0x01)`. Anyone who wires a dashboard to `isFrozen` will show a frozen
account as free. Worth one sentence in the freeze docs: which getter mirrors `setAddressFrozen`, and what
`isFrozen` means on this build.

## `eth_call` on the relay does not impersonate a contract as `from`

`canTransferFrom` judges the operator (`msg.sender`). Calling it read-only with `from` set to our market contract
returns the same answer as with an EOA that holds no allowance (`0x54`, `InsufficientAllowance`), although the
issuer's allowance to the market is unlimited and the market's real fills pass. Hedera's `eth_call` appears to
accept `from` only for accounts, so a front end cannot preview "what would the token say to the market"; it can
only preview the wallet-level checks (KYC, freeze, pause) and must explain the allowance code away. A note in the
JSON-RPC relay docs about which `from` values `eth_call` honours would save the guessing.
