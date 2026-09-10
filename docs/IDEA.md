# Bond Desk on Hedera — Project Blueprint

> **Pre-build blueprint, kept for provenance.** The shipped design differs in places: the ATS pre-check is
> `canTransferFrom(from, to, value, data)` returning `(bool, bytes1, bytes32)`; bond creation uses `deployBond`
> on the existing testnet ATS factory; the CRE verdict is signed with viem inside `handlerInTee`. See
> [`../README.md`](../README.md) for what actually runs.

## 1. One-line pitch

A compliant corporate bond issued with Hedera's Asset Tokenization Studio, traded on an on-chain order book that enforces KYC at every fill, paying coupons on a self-scheduled timer, valued by Chainlink price data, and guarded by a confidential risk monitor whose rules never leave a secure enclave.

## 2. Actors

- **Issuer** – creates the bond, posts collateral, funds coupons.
- **Investor** – KYC-approved wallet that buys, holds, trades, and redeems.
- **Compliance officer** – grants/revokes KYC, freezes, pauses (ATS roles).
- **Risk monitor** – the Chainlink CRE confidential workflow plus a relayer key.
- **Agent** – any AI agent that pays for bond data through the Bazantic gateway.

## 3. System architecture

```
                 ┌──────────────── Hedera testnet ────────────────┐
                 │                                                 │
 ATS web app ───►│  ATS Bond Token (ERC-1400 + ERC-3643 facets)    │
 (issuance, KYC) │   identity registry · compliance · freeze/pause │
                 │            ▲              ▲                     │
                 │   BondMarket          BondLifecycle ◄── HSS 0x16b (scheduled calls)
                 │   (order book)        (coupons, redeem)         │
                 │            ▲              ▲                     │
                 │        RiskGate       CollateralVault ◄── NavOracle ◄── Chainlink Data Feed
                 │            ▲                                    │
                 └────────────┼────────────────────────────────────┘
                              │ signed verdict (EIP-712)
                        Relayer (Node)
                              ▲
                 CRE Confidential Workflow (Sepolia-facing, TEE handler)
                              │
                 Liquidation Challenge config (Sepolia virtual position)

 Bond API (Node) ──► Bazantic x402 gateway + Recipe ──► agents
```

Two chains, on purpose: everything financial lives on Hedera; the confidential compute lives in Chainlink CRE (which doesn't write to Hedera), so a signed verdict crosses via the relayer.

## 4. On-chain components (Hedera testnet)

### 4.1 ATS Bond Token — reused, not written
Deploy the ATS contracts from the monorepo and create the bond through the ATS web app or SDK. What you rely on from ATS:
- ERC-1400 token with partitions, plus ERC-3643 identity registry and compliance module.
- Roles: KYC grant/revoke, freeze account, pause token, controller transfers.
- Snapshot support (used for pro-rata coupon claims).
- `canTransfer`-style pre-check (verify the exact facet function name in the ATS ABI; ERC-1400 exposes `canTransferByPartition`, ERC-3643 compliance exposes `canTransfer`).

Configure at issuance: face value, coupon rate, coupon interval, maturity, settlement token. Store these in `BondRegistry` (below) since ATS metadata fields may not cover them all.

### 4.2 BondRegistry
Single source of truth for every bond on the desk.

```solidity
struct BondTerms {
    address token;          // ATS bond token
    address settlement;     // USDC-like token used for trades/coupons
    address vault;          // CollateralVault for this bond
    uint256 faceValue;      // per token, in settlement decimals
    uint256 couponRateBps;  // annual
    uint64  couponInterval; // seconds
    uint64  nextCoupon;     // timestamp
    uint64  maturity;
    uint8   status;         // Active / Frozen / Matured / Defaulted
}
function register(BondTerms calldata) external onlyIssuer returns (uint256 bondId);
function terms(uint256 bondId) external view returns (BondTerms memory);
function setStatus(uint256 bondId, uint8 status) external onlyRiskGateOrAdmin;
```

### 4.3 BondMarket — the flagship
Non-custodial limit order book. No escrow: orders reference balances and allowances, and both legs settle atomically at fill time via `transferFrom`. That avoids the market contract itself needing KYC status.

```solidity
struct Order {
    uint256 bondId;
    address maker;
    bool    isSell;
    uint128 amount;      // bond tokens remaining
    uint128 price;       // settlement per token
    uint64  expiry;
}
function place(Order calldata) external returns (uint256 orderId);
function cancel(uint256 orderId) external;
function fill(uint256 orderId, uint128 amount) external;   // taker side
function quote(uint256 bondId) external view returns (uint128 bestBid, uint128 bestAsk);
```

Fill logic, in order:
1. Bond status must be Active (RiskGate can flip it).
2. Ask the ATS token `canTransfer(seller → buyer, amount)`; revert with the token's reason code if not allowed. This is the compliance-at-transfer guarantee.
3. Optional sanity band: if `NavOracle.mark(bondId)` is set and price deviates beyond a configurable band, revert (protects against fat-finger fills; can be disabled per bond).
4. Move settlement token buyer → seller, then bond token seller → buyer. Emit `Filled(bondId, orderId, maker, taker, amount, price)`.

Keep the book simple: price-time priority per side using a sorted linked list or just "taker picks the order id" (simplest and enough for the demo). Fees optional: a basis-point fee routed to a treasury address is a cheap extra.

### 4.4 CollateralVault
Issuer posts collateral (WHBAR or an HTS token) backing the bond. Investors get a provable, programmatic collateral leg — Hedera's "tokenized collateral" idea.

```solidity
function deposit(uint256 bondId, uint256 amount) external onlyIssuer;
function withdraw(uint256 bondId, uint256 amount) external onlyIssuer;  // blocked if coverage < minCoverage or status != Active
function coverageBps(uint256 bondId) external view returns (uint256);   // collateralValueUSD * 1e4 / outstandingPrincipalUSD
function seize(uint256 bondId) external onlyRiskGate;                    // on Defaulted: collateral becomes claimable pro-rata by holders
```

### 4.5 NavOracle
Reads Chainlink Data Feeds on Hedera testnet (`AggregatorV3Interface`; use the addresses from Chainlink's Hedera feed list). Two jobs:
- Value collateral in USD (e.g., HBAR/USD feed) for `coverageBps`.
- Compute the bond's mark: `faceValue + accruedCoupon(now)`, with an optional discount when coverage is low. Expose `mark(bondId)`.

Guard against stale rounds (`updatedAt` older than a threshold → revert or flag).

### 4.6 BondLifecycle (coupons + redemption + scheduling)
- **Funding:** issuer calls `fundCoupon(bondId)` before each date; contract holds settlement tokens.
- **Distribution:** on `payCoupon(bondId)`, take an ATS snapshot and open a claim: `claim(bondId, couponId)` pays `snapshotBalance × faceValue × rate × interval / year`. Pull-based claims avoid enumerating holders on-chain. If ATS's own coupon/corporate-action facet does what you need, call that instead and keep the scheduler; check its ABI before deciding.
- **Scheduling:** at issuance and after each coupon, call the Hedera Schedule Service system contract (address `0x16b`) to schedule `payCoupon(bondId)` at `nextCoupon` (HIP-1215 generalized scheduled contract calls; confirm the exact `scheduleCall` signature and the gas/expiry limits in the current docs, and pay the scheduling fee in HBAR). Emit `CouponScheduled(bondId, scheduleId, when)`.
- **Maturity:** `redeem(bondId)` after `maturity`: holders burn/return tokens and receive principal; status → Matured.

### 4.7 RiskGate
Bridge from the confidential workflow to Hedera. Verifies an EIP-712 signed verdict from the workflow's signer and applies it.

```solidity
struct Verdict { uint256 bondId; uint8 action; uint256 coverageObserved; uint64 issuedAt; uint64 nonce; }
// action: 0 = OK, 1 = WARN (flag only), 2 = FREEZE (status Frozen, market halts), 3 = DEFAULT (vault.seize)
function submit(Verdict calldata v, bytes calldata sig) external;  // anyone can relay; signature must match trusted signer; nonce strictly increasing; issuedAt within freshness window
function unfreeze(uint256 bondId) external onlyAdmin;                // manual recovery path
```

Use an audited ECDSA/EIP-712 library as a dependency (open-source libraries are allowed under Start Fresh). The private thresholds that produce the verdict never appear on-chain; only the action does.

## 5. Off-chain components

### 5.1 CRE Confidential Workflow (TypeScript)
- Trigger: cron every few minutes.
- Enclave handler (`handlerInTee`): fetch the private policy with `getSecret` (min coverage, warn band, default grace period, plus the Hedera RPC credential if you use a private endpoint); read `coverageBps`, market status, and any off-chain issuer signal over HTTP inside the enclave; decide the action; sign the `Verdict` with the enclave-held key. Only the signed verdict leaves the enclave.
- Non-confidential part (`usingTheDons` path): return the signed payload for the relayer to pick up (log output in simulation).
- Evidence: capture `cre workflow simulate` output showing the enclave decision and signature; commit logs to `docs/cre-evidence/`.

### 5.2 Liquidation Challenge config
Same workflow structure, second config: reads Chainlink's virtual ETH/USDC position on Sepolia, private thresholds for "add collateral / repay part / repay more", executes the on-chain action through the challenge contract, and calls `join()`. Keep the decision function shared with the bond monitor so it is clearly one product.

### 5.3 Relayer (Node)
Reads verdicts from the workflow output, submits `RiskGate.submit` on Hedera with a funded testnet key. Idempotent by nonce; retries on relay errors.

### 5.4 Bond API (Node)
Read-only endpoints backed by the Hedera JSON-RPC relay and Mirror Node:
- `GET /bonds` — terms, status, mark, coverage, next coupon.
- `GET /bonds/:id/orderbook` — best bid/ask, depth.
- `GET /bonds/:id/risk` — last verdict action and time.

### 5.5 Bazantic gateway + Recipe
Register the Bond API as a new service, create the x402/MPP gateway, and write a Recipe: "check the wallet's token associations on Hedera Mirror Node → fetch eligible bonds by yield from Bond API → return the best-yielding bond the wallet can actually hold." Record the A/B: raw API calls vs. the Recipe.

## 6. Hedera Foundry Harness (Harness track)

A new harness for Solidity/Foundry developers, inspired by hedera-harness. Contents:
- `HederaHarness.sol`: helpers for HTS association and transfers via the `0x167` precompile, Schedule Service calls via `0x16b`, chain-id/network constants, and cheat-friendly wrappers for tests.
- `script/`: `Deploy.s.sol` (relay-aware broadcast), `Verify.sh` (Sourcify → HashScan), `Faucet.md`.
- `test/`: mocks for HTS and HSS so unit tests run without the network, plus fork tests against testnet.
- README with "before/after": how many lines it took to get a working scheduled contract call and a verified deployment without vs. with the harness.

This is the toolkit you use to build sections 4.4–4.6, so it grows naturally out of the main build.

## 7. Repository layout

```
bond-desk/
  contracts/            BondRegistry, BondMarket, CollateralVault, NavOracle, BondLifecycle, RiskGate
  ats/                  pinned ATS submodule/config + deployment addresses
  harness/              hedera-harness-foundry (own README)
  workflow/             CRE workflow (bond monitor + challenge config)
  relayer/              verdict relayer
  api/                  Bond API + Bazantic recipe files
  docs/                 architecture.png, cre-evidence/, FEEDBACK/notes per sponsor
  README.md             pitch, diagram, per-track "where to look" with file:line links
```

## 8. Testing plan

- Unit (Foundry, mocks): order placement/cancel/fill math, compliance revert paths (unapproved buyer, frozen seller, paused token), coverage math with stale-feed guard, coupon accrual and pro-rata claims, RiskGate signature/nonce/freshness checks, seize-on-default.
- Fuzz/invariants: settlement conservation on fills; no fill leaves either party with a negative balance; nonce monotonicity in RiskGate; sum of coupon claims ≤ funded amount.
- Fork tests (Hedera testnet RPC): real ATS token `canTransfer` behavior, real Chainlink feed read, one real scheduled call.
- Workflow: `cre workflow simulate` for both configs; assert the action changes when the private threshold changes.

## 9. Demo storyline

1. Issuer creates the bond in the ATS app; two investors get KYC; a third does not.
2. Non-KYC wallet tries to buy on BondMarket → reverts with the compliance reason. KYC wallet buys → fills, explorer link.
3. Issuer posts collateral; NavOracle shows coverage from the live feed.
4. Scheduled coupon fires; investor claims; HashScan shows the scheduled transaction.
5. Simulated price drop → workflow logs show the enclave verdict FREEZE → relayer submits → market rejects new fills → admin unfreezes.
6. Agent calls the Bazantic Recipe and gets the best eligible bond.
7. Harness: side-by-side line count for deploy + schedule + verify.

## 10. Submission checklist

- Partners selected: Hedera, Chainlink, Bazantic.
- Contracts verified on HashScan (re-verify after any redeploy).
- README sections per track with file and line pointers; architecture diagram; run instructions.
- CRE simulation logs committed; challenge `join()` transaction hash recorded.
- Harness README with before/after evidence.
- Bazantic username, gateway link, Recipe link, A/B recording.
- Video within ETHGlobal's 2–4 minute rule (sponsors allow up to five).
- Commit history shows incremental work; no code copied from prior projects.

## 11. Known risks and their mitigations

- ATS internals are intricate → treat ATS as a black box behind `canTransfer`, snapshots, and role calls; don't modify facets.
- Schedule Service signature/limits may differ from what you expect → confirm the ABI in the current docs and wrap it in the harness so only one file changes.
- CRE cannot write to Hedera → the signed-verdict relay is the documented design, not a workaround; say so in the README.
- Testnet reset wipes verification → keep the verify script one command.
- Scope → sections 4.1–4.3 plus the harness already qualify for both Hedera tracks; everything after that is extra points.