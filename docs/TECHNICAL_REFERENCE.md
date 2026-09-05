# Bond Desk on Hedera — Implementation-Level Technical Reference

*Facts-only build reference verified against primary sources (official docs, GitHub repos, HIPs). Every item flagged **UNVERIFIED** could not be confirmed from a primary source and must be read from the cited repo/page before implementation.*

## TL;DR
- All nine subsystems are buildable today: ATS (v7.0.0) provides ERC-1400/ERC-3643 bond contracts + SDK; Hedera Schedule Service `scheduleCall` (0x16b, HIP-1215) is live at consensus node v0.68; the Chainlink CRE TypeScript SDK supports confidential TEE handlers (`handlerInTee`); and the ETHOnline 2026 liquidation-challenge addresses are confirmed.
- Highest-confidence, primary-source facts: HSS/HTS system-contract signatures + selectors, Hedera testnet dev facts (chain 296, hashio RPC, Sourcify verification), and the CRE project structure/commands/chain selectors.
- Flagged **UNVERIFIED**: exact ATS pre-deployed testnet Factory/Resolver addresses; exact ATS Bond Solidity struct fields, coupon function signatures, role bytes32 constants, default partition id; exact Hedera testnet Chainlink proxy addresses; Bazantic CLI command names/Recipe format; the liquidation contract's non-`join()` signatures and numeric threshold; hedera-harness README command surface.

## Key Findings

### 1. Asset Tokenization Studio (ATS)
- Repo `github.com/hashgraph/asset-tokenization-studio`, latest release **v7.0.0-ats** (npm `@hashgraph/asset-tokenization-sdk` v7.0.0). Apache-2.0.
- Monorepo (npm workspaces): `packages/ats/{contracts,sdk}`, `packages/mass-payout/{contracts,sdk}`, `apps/ats/web`, `apps/mass-payout/{backend,frontend}`, `apps/docs`, `docs/`.
- **Node.js**: ATS requires v20.19.4+; Mass Payout backend requires v24.0.0+. npm v10.9.0+. PostgreSQL for Mass Payout backend.
- Contracts use the **diamond pattern** with modular facets (ERC-1400, ERC-3643, Hold, Clearing). Factory + BusinessLogicResolver + proxy architecture.

### 2. Hedera Schedule Service (HSS) — HIP-1215
- System contract at **0x16b**. `IHederaScheduleService` (HIP-755) + generalized scheduled calls (HIP-1215, consensus node v0.68).

### 3. Chainlink Data Feeds on Hedera
- Data Feeds + Proof of Reserve went live on Hedera mainnet Dec 16, 2024; consumed via `AggregatorV3Interface.latestRoundData()`.

### 4. Hedera testnet dev facts
- Chain ID 296; hashio RPC; Sourcify (sourcify.dev) verification.

### 5. Chainlink CRE
- TypeScript SDK `@chainlink/cre-sdk`; `cre init`; `handlerInTee` for confidential TEE execution.

### 6. Liquidation challenge (ETHOnline 2026)
- Challenge contract confirmed on Sepolia; `join()` to enter.

### 7. Bazantic
- x402/MPP gateway + Recipe (ETHOnline 2026 sponsor).

### 8. hedera-harness
- `github.com/hedera-dev/hedera-harness` (TypeScript, MIT).

### 9. Testnet reset + Mirror Node
- Reset roughly quarterly; Mirror Node REST base `https://testnet.mirrornode.hedera.com/api/v1/`.

## Details

### 1. ASSET TOKENIZATION STUDIO (ATS)

**a. Monorepo, Node, install/build, web app env.**
Structure (verbatim from README):
```
├── packages/
│   ├── ats/{contracts,sdk}
│   └── mass-payout/{contracts,sdk}
├── apps/
│   ├── ats/web
│   ├── mass-payout/{backend,frontend}
│   └── docs
├── docs/
└── package.json
```
Commands (verbatim):
- Full: `npm run setup` (installs deps, compiles contracts, builds SDKs, sets up web + backend).
- ATS-only: `npm run ats:setup`; clean: `npm run ats:setup:clean`.
- Build/start/test: `npm run ats:build`, `npm run ats:start`, `npm run ats:test`.
- Node: ATS v20.19.4+, npm v10.9.0+.
- Web app env file: `apps/ats/web/.env` — "Defines Hedera endpoints, resolver and factory IDs, and WalletConnect settings." Sample provided as `.env.example`. Uses WalletConnect; supports MetaMask, HashPack, Blade.
- SDK init config includes: "factory contract Hedera Id, resolver contract Hedera Id, common, equity and bond business logic keys the SDK will connect to."
- Mass Payout backend `.env` example shows Hedera network config: `ATS_NETWORK=testnet`, `ATS_MIRROR_URL=https://testnet.mirrornode.hedera.com/api/v1/`, `ATS_RPC_URL=https://testnet.hashio.io/api`, plus `ATS_FACTORY_ADDRESS` / `ATS_RESOLVER_ADDRESS` (shown as placeholders `0.0.123456` / `0.0.123457`).

**b. Contract deployment.** Contracts are Hardhat-based (`packages/ats/contracts`). ATS uses Factory contracts to create securities, resolver contracts to manage/execute functions, and proxy contracts for upgrades. **UNVERIFIED**: the exact Hardhat task names for deploying Factory/BusinessLogicResolver/facets, and whether official pre-deployed testnet Factory/Resolver addresses are published. The SDK's default network config references these IDs but no canonical testnet addresses were confirmable from a primary source (examples in the repo are placeholders like `0.0.123456`).

**c. Bond creation & ABI functions.** ATS supports bonds and equities on the ERC-1400 core (interoperable with ERC-20, ERC-1410, ERC-1594, ERC-1643, ERC-1644) with partial ERC-3643 (T-REX) support. Features: identity registry, compliance modules, granular freeze, role-based access, corporate actions (coupons/dividends), snapshots, controller/forced transfer. **UNVERIFIED**: exact Solidity struct field names for bond creation (name/symbol/decimals/currency/nominal value/maturity/coupon rate/frequency/start/first-coupon dates), exact coupon function signatures (setCoupon/getCoupon/getCouponFor/getCouponHolders/getTotalCouponHolders), the KYC/freeze/pause/controller/`canTransfer(ByPartition)` signatures, and exact facet file names. Read from `packages/ats/contracts` source. (Note: the ATS SDK doc references partition-based operations such as "Create Hold by Partition," confirming ERC-1410 partition semantics at the SDK layer.)

**d. Role identifiers.** ATS uses role-based access control with named roles such as Minter and Controller. **UNVERIFIED**: exact bytes32 role constant values for admin, KYC, freeze, pause, corporate actions, controller.

**e. Partitions.** Core is ERC-1400/ERC-1410 (partitioned). SDK exposes partition-based operations ("Create Hold by Partition"). Standard ERC-20 interop is included. **UNVERIFIED**: default partition id value and exact transferByPartition vs standard ERC-20 transfer behavior, and whether approve/transferFrom works for a third-party order-book contract pulling tokens from a seller.

**f. Mass Payout (coupon PAYOUT).** ATS ships a separate **Scheduler Payment Distribution (Mass Payout)** suite for batch payouts (dividends, bond coupons) across thousands of accounts; supports HBAR and HTS tokens; snapshots balances at record date for pro-rata payments; backend is NestJS + PostgreSQL; uses DFNS for signing. Setup: `npm run mass-payout:setup` (or manual: `npm ci`; `npm run mass-payout:contracts:build`; `...:sdk:build`; `...:backend:build`; `...:frontend:build`; then `docker-compose up -d` for PostgreSQL in `apps/mass-payout/backend`). So ATS provides both coupon RECORDS (ATS core corporate actions) and PAYOUT (Mass Payout).

**g. Gotchas.** Diamond pattern → many facets to verify individually; HashScan verification is via Sourcify (see §4). Testnet HBAR required for deployment. Contract-size/diamond-loupe considerations apply to the diamond facets.

### 2. HEDERA SCHEDULE SERVICE (HSS) & HTS

**HSS at 0x16b.** Function table (verbatim signatures + selectors from docs.hedera.com):
- `scheduleCall(address, uint256, uint256, uint64, bytes) external returns (int64, address)` — selector `0x6f5bfde8`, node v0.68, HIP-1215. Prose params: `scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes memory callData)`. Returns responseCode (22 = SUCCESS) and scheduleAddress.
- `scheduleCallWithPayer(address, address, uint256, uint256, uint64, bytes) external returns (int64, address)` — `0xe6599c18`. Collects signatures but executes only at `expirySecond`.
- `executeCallOnPayerSignature(address, address, uint256, uint256, uint64, bytes) external returns (int64, address)` — `0x105772b2`. Executes immediately once payer signs (unless consensus time already past `expirySecond`).
- `deleteSchedule(address) external returns (int64)` — `0x72d42394`; parameterless redirect `deleteSchedule() external returns (int64)` — `0xc61dea85`.
- `hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool)` — `0xdfb4a999` (approx cost of a cold SLOAD; use in a `findAvailableSecond()` retry pattern per HIP-1215).
- `signSchedule(address schedule, bytes memory signatureMap) external returns (int64)` — `0x358eeb03` (HIP-755, v0.59).
- `authorizeSchedule(address) external returns (int64)` — `0xf0637961` (HIP-755, v0.57).
- `scheduleNative(address, bytes, address) external returns (int64, address)` — `0xca829811` (HIP-756, v0.59; currently supports HTS 0x167 for token create/update).

**Correction to the candidate signature**: the verified parameter order for `scheduleCall` is **`(to, expirySecond, gasLimit, value, callData)`** and it includes a **`uint64 value`** (tinybars) argument — not the `(to, gasLimit, expirySecond, callData)` order in the task's candidate. Behavior: `scheduleCall` variants do **not** revert; on failure they return a zero address plus a failure code from `ResponseCodeEnum` (e.g., `SCHEDULE_EXPIRY_IS_BUSY`). Costs: per `hashgraph/hedera-docs` hedera-schedule-service.md — "Schedule transaction fees are the same as a HAPI sign schedule transaction, with a 20% markup for using system contracts... Expired transactions cost no additional fees beyond the initial scheduling and signature costs." HIP-1215 is available at consensus node **v0.68**, which went live on Hedera testnet around Nov 13, 2025 with mainnet targeted for December 2025 (per third-party coverage of Hedera's Consensus Node v0.68 "Dynamic Address Book" release; **confirm testnet is on ≥v0.68 at build time**).

**HTS at 0x167.** From `hashgraph/hedera-smart-contracts` `IHederaTokenService.sol` / `HederaTokenService.sol`:
- `associateToken(address account, address token) external returns (int64 responseCode)`.
- `address constant precompileAddress = address(0x167)`; `int32 constant defaultAutoRenewPeriod = 7776000` (90 days).
- `HederaResponseCodes.SUCCESS == 22`.
- Import path: `@hashgraph/hedera-smart-contracts` (also mirrored as `@hiero-ledger/hiero-contracts/token-service`). Defined by HIP-206/376/514. Common pattern: `require(rc == HederaResponseCodes.SUCCESS || rc == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT, "Association failed");`.
- Hedera EVM quirk: a contract must associate an HTS token before it can receive it (unless auto-association). Pure ERC-20 (non-HTS) tokens deployed as ordinary Solidity contracts work normally without association.

### 3. CHAINLINK DATA FEEDS ON HEDERA TESTNET
- Chainlink Data Feeds + Proof of Reserve went live on Hedera mainnet **Dec 16, 2024**, per Hedera's official blog "Hedera Adopts the Chainlink Data Standard": "Chainlink Data Feeds and Chainlink Proof of Reserve... are now live on the Hedera network"; the HBAR Foundation had joined Chainlink Scale in October 2024. (CCIP and Data Streams followed in 2025.)
- Feed addresses page: `docs.chain.link/data-feeds/price-feeds/addresses` (select network). Feed data browser at `data.chain.link/feeds/hedera/hedera/<pair>` (e.g., `hbar-usd`). HBAR/USD ENS name `hbar-usd.data.eth`.
- Consumption: `import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";` then `latestRoundData()`. USD feeds typically use 8 decimals.
- **UNVERIFIED**: exact Hedera testnet (chain 296) proxy addresses + decimals + heartbeat for HBAR/USD, USDC/USD, ETH/USD, BTC/USD. The addresses page is JS-rendered and did not expose the testnet table for fetch; confirm on the live page filtered to Hedera testnet, or via the ENS `*-usd.data.eth` names.

### 4. HEDERA TESTNET DEV FACTS
- **Chain ID 296** (mainnet 295, previewnet 297). Native token HBAR.
- JSON-RPC relay: **`https://testnet.hashio.io/api`** (Hashio, hosted by Swirlds Labs; "for development and testing purposes only"). Alternatives: Arkhia, or a self-hosted Hedera JSON-RPC Relay.
- HashScan testnet explorer: `https://hashscan.io/testnet`.
- Mirror Node testnet REST base: `https://testnet.mirrornode.hedera.com/api/v1/`.
- **Faucet / HBAR amounts**: Hedera Portal (`portal.hedera.com`) accounts get 1,000 testnet HBAR with a daily refill limit of 1,000 HBAR (one manual refill per 24h); the anonymous faucet gives up to 100 testnet HBAR every 24 hours (per Hedera blog "Introducing a New Testnet Faucet and Hedera Portal Changes," Feb 1, 2024, and docs.hedera.com getting-started). Chainlink's faucet also serves Hedera testnet native + LINK at `faucets.chain.link/hedera-testnet`.
- **Sourcify verification**: Hedera Mainnet (295) and Testnet (296) are supported on the main Sourcify instance at **sourcify.dev**. Per Hedera's official blog: "Foundry – `forge verify-contract` works with the default Sourcify verifier, with **no custom verifier URL required**." Hardhat: the standard `@nomicfoundation/hardhat-verify` plugin works with the default Sourcify verifier. Verified contracts auto-appear on HashScan. **Note**: the task's candidate `--verifier-url https://server-verify.hashscan.io` refers to the older Hedera-hosted Sourcify (`hashgraph/hedera-sourcify`); current guidance is the default sourcify.dev verifier, i.e. `forge verify-contract --verifier sourcify --chain-id 296 <address> <Contract>` without a custom verifier URL.
- JSON-RPC decimals quirk: the relay's `msg.value` and `gasPrice` return 18 decimals.
- **UNVERIFIED / to confirm**: exact Foundry config quirks (gas price, eip-1559 vs legacy tx, block gas limit), and whether `forge script --broadcast` and `anvil --fork-url` work reliably against Hedera. Reference tutorials exist: hedera-dev `tutorial-js-foundry-deploy-and-verify-smart-contract` and `tutorial-js-fork-hedera-testnet` (plus `tutorial-foundry-unit-test`, `tutorial-foundry-test-event`).

### 5. CHAINLINK CRE (TypeScript SDK)
- SDK: **`@chainlink/cre-sdk`**; source `github.com/smartcontractkit/cre-sdk-typescript`. Requires **Bun ≥1.2.21**. CRE CLI ≥1.8.0.
- `cre init` scaffolds a project; prompts for project name, language (TypeScript), and a template (e.g., "Helloworld: Typescript Hello World example"). Non-interactive: `cre init --non-interactive`. Templates listing: `cre templates list --json`.
- Project structure (from docs):
```
myProject/
├── .env               # secret values (never commit)
├── .gitignore
├── project.yaml       # global config
├── secrets.yaml       # secret name declarations
├── contracts/abi/
└── <workflow dir>/    # main.ts, config.json, workflow.yaml
```
- `project.yaml` holds global config (incl. RPC endpoints for local simulation, e.g., `ethereum-testnet-sepolia`) and `CRE_ETH_PRIVATE_KEY` via `.env`. `workflow.yaml` has **targets** (`cre init` pre-populates `staging-settings` and `production-settings`), each with `workflow-name` (with `-staging`/`-production` suffix), `workflow-path: "./main.ts"`, `config-path` (e.g. `config.staging.json`/`config.production.json`), `secrets-path`.
- Core imports: `import { Runner, handler, cre, HTTPClient, EVMClient, CronCapability, HTTPCapability, getNetwork, consensusMedianAggregation } from "@chainlink/cre-sdk"`.
- Skeleton: `const runner = await Runner.newRunner<Config>({ configSchema }); await runner.run(initWorkflow);`. `initWorkflow(config)` returns handler entries; `cre.handler(trigger, handler)` pairs a trigger with a handler. Config declared in a co-located `config.json`, validated with Zod (`z.object({...})`).
- Consensus / node mode: `runtime.runInNodeMode(fn, aggregator)`; crossing back from the enclave to the DON: `runtime.usingTheDons()`.
- Secrets: `runtime.getSecret()` (names declared in `secrets.yaml`; values from `.env` / vault).
- **EVM client (TS)**: `const network = getNetwork({ chainFamily: "evm", chainSelectorName: "ethereum-testnet-sepolia" }); const evmClient = new EVMClient(network.chainSelector.selector);`. **Ethereum Sepolia chain selector = `16015286601757825753n`**; Avalanche Fuji = `14767482510784806043n` (via `EVMClient.SUPPORTED_CHAINS`).
- **On-chain write**: two-step — `runtime.report()` generates a signed report, then `evmClient.writeReport()` submits it to the Chainlink **KeystoneForwarder**, which verifies signatures and calls the consumer's `onReport()`. Consumer implements **`IReceiver`** (is IERC165) with **`onReport(bytes metadata, bytes report)`**. **KeystoneForwarder on Ethereum Sepolia (production) = `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`**. MockKeystoneForwarder addresses are used when running `cre workflow simulate --broadcast`.
- **Simulation**: `cre workflow simulate <workflow> --target staging-settings` (or set `CRE_TARGET`); supports `--broadcast`; config/secrets are resolved via the selected target's `config-path`/`secrets-path`. Simulation requires a CRE account and login: `cre login` (verify with `cre whoami`).
- **Confidential Workflows** (private beta): concept doc `docs.chain.link/cre/concepts/confidential-workflows`; guide `.../using-confidential-workflows/making-workflow-confidential`. Register a TEE handler with **`handlerInTee`** (TypeScript) / **`cre.HandlerInTee`** (Go); the callback receives a **`TeeRuntime`** (`cre.TeeRuntime` in Go). Secrets fetched inside the enclave via `runtime.getSecret()`; cross back to the DON via `runtime.usingTheDons()`. Template: **"Hello Confidential Workflows"** at `docs.chain.link/cre-templates/hello-confidential-workflows` — it "registers a TEE handler, securely fetches a secret inside the enclave, executes a capability call from within the enclave, and returns to the DON for any operations requiring decentralized consensus." Starter templates live under `github.com/smartcontractkit/cre-templates/tree/main/starter-templates/confidential-workflows`. Deployment requires enrollment; simulation does not.
- **TEE signing model** (important for a "signed verdict relayed to a Hedera contract"): the enclave does **not** expose an arbitrary application signing key. Protected-by-default items are Vault DON secrets, sensitive inputs, and in-enclave computation; **not** protected are triggers, chain reads/writes, source code/binary, and any output (reports, calldata) crossed back out. For on-chain delivery you must cross back to the DON and produce a **DON-signed Keystone report** (`runtime.report()` → `evmClient.writeReport()`), verified by the KeystoneForwarder. A raw in-enclave EIP-712 signature is not the delivery mechanism; the DON-signed report is. Confidential *logic* is not yet protected (only data) in the current beta. **Design implication for Bond Desk**: the CRE verdict targets an EVM chain (e.g., Sepolia) via KeystoneForwarder + `IReceiver.onReport`; relaying that verdict onto a Hedera contract requires a bridge/cross-chain step (e.g., CCIP Hedera↔Sepolia) or a separately signed relay — the Forwarder pattern itself is EVM/Sepolia-oriented.

### 6. AUTOMATED LIQUIDATION PROTECTION CHALLENGE (ETHOnline 2026)
- Challenge repo: `github.com/solangegueiros/cf-liquidation-protection-challenge`; docs template `docs.chain.link/cre-templates/automated-liquidation-protection` (TypeScript).
- **Challenge contract (Sepolia): `0x88574e7Cc0027afd04951daa09B64d4441931ba1`** (confirmed).
- **Virtual USD token: `0x6Fe92Ead5299040f50F095860b5A0A7A2D4041A2`**; **Virtual ETH token: `0x5dED1a40c3D56dA42E7f932f781c0432556c9814`** (both confirmed).
- Confirmed function: **`join()`** — "Use the function `join()` to join the challenge, from Sept 9 to hackathon submission deadline."
- Goal (verbatim, ETHGlobal): "Build a Confidential Workflow that protects a virtual ETH-collateral/USDC-debt position during simulated market movements. The workflow must: Avoid liquidation. Preserve the benefit of keeping the loan open. Use emergency capital efficiently. Keep sensitive protection rules and credentials private."
- Scoring (verbatim): "After the deadline, Chainlink team will run the scenarios, during the next 24h and discover the winner. You can not update your workflow after the hackathon submission deadline." The workflow must `join()` the on-chain Sepolia contract, implying a registered/deployed workflow (not merely local simulation) for scoring; general CRE prizes accept either a CRE CLI simulation or a live deployment.
- Prize value: $500 (ETHGlobal). Deploy-access is gated behind a Google Form linked from the ETHGlobal prizes page.
- **UNVERIFIED**: the contract's other function signatures (position getters, add-collateral, repay, withdraw; whether "emergency capital" is a named function vs. a stated goal), and the numeric liquidation threshold. Read directly from the repo source or the verified contract tab on Sepolia Etherscan (`0x88574e7Cc0027afd04951daa09B64d4441931ba1`).

### 7. BAZANTIC
- Used in ETHOnline 2026 (verbatim, ETHGlobal): participants "Create an x402/MPP Gateway in Bazantic for your project" and "Create a Recipe that explains when, why, and how to use your service." A Recipe can chain multiple services (example given: Uniswap API `GET /swap` → 1inch Trace API) into one working flow; the account is attributed by "email or GitHub handle depending on what you use to register."
- Standards context: x402 = open HTTP-402 payment standard (Apache-2.0; HTTP 402 → pay → retry with proof). MPP = Machine Payments Protocol (Stripe + Tempo), embedding payment negotiation into HTTP/MCP (401/402 challenge → verify → `Payment-Receipt`).
- **UNVERIFIED**: exact `@bazantic/cli` command names, auth-type options (including `jwt`), Recipe file format/fields, the exact way an agent/MCP client calls a Bazantic gateway, and the pricing unit "mcents." bazantic.com docs did not surface in accessible search results; confirm directly at bazantic.com.

### 8. HEDERA HARNESS
- `github.com/hedera-dev/hedera-harness` — **TypeScript**, MIT license, part of the hedera-dev org (last updated Aug 12, 2026).
- Also distributable as a hedera-skills plugin: `/plugin install hedera-harness` (after `/plugin marketplace add hedera-dev/hedera-skills`).
- Related repo `github.com/hedera-dev/hedera-skills` (Apache-2.0) exposes plugins: `agent-kit-plugin`, `system-contracts` (incl. `hts-system-contract` for 0x167), `cross-chain`, `native-services-js`, `hackathon-helper`, `hedera-harness`, `dev-intelligence`; plus `review-harness-spec` (a two-axis audit via `check-spec.sh` + Oracle judgment).
- **UNVERIFIED**: exact hedera-harness README quickstart commands and API surface (create account, create token, deploy contract, HCS topic). The repo page was not directly fetchable; read its README to mirror its ergonomics in a Foundry/Solidity harness.

### 9. HEDERA TESTNET RESET & MIRROR NODE
- **Reset schedule**: Hedera testnet is reset roughly once per quarter — per docs.hedera.com testnet page, "The mirror node and consensus node test network are scheduled to be reset periodically"; the testnet mirror node data remains available for a window (about two weeks) after each reset before being wiped. Plan for account/token/contract re-creation after each reset.
- Mirror Node testnet REST base: `https://testnet.mirrornode.hedera.com/api/v1/`.
- Account token associations: `GET /api/v1/accounts/{id}/tokens`.
- Contract results: `GET /api/v1/contracts/results` and `GET /api/v1/contracts/{id}/results`.

## Recommendations
1. **Lock down ATS internals first (highest-value gap).** Clone ATS v7.0.0 and read `packages/ats/contracts` to extract the exact bond struct fields, coupon function signatures (setCoupon/getCoupon/getCouponFor/getCouponHolders), KYC/freeze/pause/controller and `canTransfer(ByPartition)` signatures, the bytes32 role constants, and the default partition id. Benchmark to change plans: if the order-book contract must pull seller tokens, confirm approve/transferFrom (or transferByPartition operator) is honored under ATS compliance before designing settlement.
2. **Confirm live Hedera testnet Chainlink feeds.** Before wiring valuation, verify the chain-296 proxy addresses/decimals/heartbeats on the addresses page filtered to Hedera testnet (or resolve `hbar-usd.data.eth` etc.). If a needed pair is mainnet-only on Hedera, plan a fallback (derive via two feeds, or mock on testnet).
3. **Design the CRE→Hedera relay explicitly.** The KeystoneForwarder + `IReceiver.onReport` path is EVM/Sepolia-oriented; to land a CRE verdict on a Hedera contract, plan either a CCIP Hedera↔Sepolia hop or a custom signed relay. Prototype with `cre workflow simulate --broadcast` against a MockKeystoneForwarder, then move to the Sepolia production Forwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`.
4. **For the liquidation challenge**, read the verified contract on Sepolia Etherscan to extract the full ABI and threshold; ensure the workflow calls `join()` before the deadline (it cannot be updated after) since Chainlink runs scenarios within 24h post-deadline.
5. **Obtain Bazantic CLI docs directly from bazantic.com** for the exact gateway-creation commands, auth types (jwt), Recipe schema, and mcents pricing — these are unverifiable from third-party sources.
6. **Account for testnet resets** in the build: script re-creation of accounts, HTS tokens, ATS deployments, and re-association after each quarterly reset.

## Caveats
- This is a facts-only reference; verify all **UNVERIFIED** items against the cited primary sources before implementation.
- ATS pre-deployed testnet addresses shown in SDK/backend examples are placeholders (`0.0.123456`), not canonical addresses.
- HSS/HIP-1215 is enabled at consensus node v0.68; confirm testnet is on ≥v0.68 at build time, and note scheduled-call execution is in "consensus time" (not guaranteed at an exact wall-clock second) and subject to per-second capacity throttling (`hasScheduleCapacity`).
- The verified `scheduleCall` signature order is `(to, expirySecond, gasLimit, value, callData)` with a `uint64 value`, differing from the task's candidate — use the verified order.
- Confidential Workflows is in private beta; deployment requires enrollment (simulation does not), and confidential *logic* (not just data) is not yet protected — do not rely on hiding the workflow's rules in the compiled binary.
- Dates for CRE CLI/SDK versions, v0.68 rollout, and Chainlink-on-Hedera milestones reflect sources current as of the research date (Sept 9, 2026); re-verify version/network status at build time.