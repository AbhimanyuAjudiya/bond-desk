# ETHGlobal submission fields

Everything the ETHOnline 2026 project form asks for, ready to paste. The form lives at
<https://ethglobal.com/events/ethonline2026/project> (steps: Project details, Images, Tech stack, Select prizes,
Video, Future, Final). The second check-in was submitted on 2026-09-12 with the same facts.

## Project details

| Field | Value |
|---|---|
| Project name | Bond Desk |
| Category | DeFi |
| Emoji | 🏛️ |
| Demonstration link | https://wd6nrvmajt.ap-south-1.awsapprunner.com |
| Short description (≤100 chars) | Compliant bond desk on Hedera: KYC-gated order book, scheduled coupons, TEE risk monitor |
| GitHub repository | https://github.com/AbhimanyuAjudiya/bond-desk (link the GitHub account in the form, then pick `bond-desk`) |

### Description

Bond Desk is a compliant corporate bond market on Hedera, policed from inside a TEE.

A bond issued through Hedera's Asset Tokenization Studio trades on an on-chain order book that asks the token's own
compliance check (canTransferFrom) before every fill, so KYC is enforced by the contract, not the UI. Coupons are
fired by the Hedera Schedule Service (HIP-1215 scheduleCall from the contract, which re-schedules itself from inside
the executed call), collateral is HBAR valued against the live Chainlink HBAR/USD feed, and a Chainlink CRE
confidential workflow reads coverage inside an enclave, decides against thresholds that never leave it, and signs an
EIP-712 verdict that any unprivileged relayer can land on Hedera.

The property that ties it together: the policy is private, the verdict is public and verifiable. An observer can
check that a freeze was justified by the coverage the verdict carries without learning where the thresholds sit.

The same desk is a web app, an OpenAPI service, a paid Bazantic gateway with an MCP server, and a three-service
Recipe (Hedera Mirror Node, Bond Desk, Bank of Canada Valet) that lets an agent find the best bond a wallet is
allowed to hold and whether it clears the sovereign benchmark.

Everything ran on Hedera testnet with Sourcify-verified contracts and a transaction receipt for every step: issuance
through the live ATS factory, KYC grants and an ATS-native freeze, a rejected non-KYC fill and an accepted KYC fill,
collateral valued against the feed, three coupons paid by the Schedule Service (the third fired on its own after we
fixed a block-timestamp lag), WARN and FREEZE verdicts relayed, a fill rejected while frozen, an unfreeze. Both CRE
workflows are deployed on the network: the bond monitor delivers its own verdicts to Hedera hourly, and the
liquidation-protection workflow defends our position in Chainlink's Sepolia challenge every 30 seconds.

### How it's made

Contracts: Foundry, Solidity 0.8.28, OpenZeppelin v5. Six contracts (BondRegistry, BondMarket, CollateralVault,
NavOracle, BondLifecycle, RiskGate) around an ATS v8 bond token created through the existing testnet factory; ATS is
treated as a black box behind its canTransferFrom, KYC, snapshot and freeze facets. BondLifecycle is the Schedule
Service payer: scheduleCall on the 0x16b system contract, and each executed coupon arms the next. We hit the
out-of-gas nested schedule and the block.timestamp lag on testnet and fixed both (SCHEDULE_GAS 4M, SCHEDULE_LAG
10 s). RiskGate verifies EIP-712 verdicts: trusted signer, strictly increasing nonce, freshness window.

Chainlink CRE: TypeScript SDK 1.20, handlerInTee pinned to AWS Nitro, one batched JSON-RPC read per run because
Hedera is not a CRE-supported chain, viem signing inside the enclave, secrets in the Vault DON. The same decide.ts
policy module drives the Sepolia liquidation-protection workflow, which probes the challenge contract's onlyActive
gate inside its read batch so it never spends gas outside a scoring window. Relayer: Node and viem, verifies the
signature locally before paying gas; in production the enclave delivers directly.

API and app: Hono on Node 22 with mirror-node history and eth_call state, an OpenAPI document, served from one AWS
App Runner image together with the Vite/React/wagmi app (order book, coupons, collateral, risk with verdict relay,
compliance desk); testnet self-service KYC via EIP-191 signed messages and an officer key. Every write is simulated
first so a revert is decoded into a sentence before the wallet signs.

Bazantic: three gateways (Bond Desk API, Hedera Mirror Node testnet, Bank of Canada Valet) and a Recipe with seven
tool bindings, republished through Bazantic's control MCP and tested from the dashboard on a KYC and a no-KYC wallet.

Hedera Harness: a Foundry harness with mocks for 0x16b and 0x167, a HederaTest base that fires due schedules, and
doctor/verify/validate-schedule scripts; PR #62 upstream adds the check that a scheduled transaction executed AND
its child succeeded, because the schedules endpoint cannot tell the two apart.

Hacky and notable: explicit gas overrides where hashio's estimator is wrong, the scheduling lag, splitting CRE
secrets into two files for a 10-id cap, and the discovery that cre execution logs returns confidential-handler logs
once per DON node.

## Images

`docs/img/app-order-book.jpg`, `docs/img/app-risk.jpg`, `docs/img/bazantic-test-kyc.jpg`.

## Tech stack

Solidity, Foundry, OpenZeppelin, Hedera (Asset Tokenization Studio, Schedule Service HIP-1215, HTS, mirror node,
HashScan/Sourcify), Chainlink (CRE Confidential Workflows, Data Feeds), TypeScript, Bun, viem, wagmi, React, Vite,
Hono, Node 22, Docker, AWS App Runner, Bazantic (x402/MPP gateways, MCP, Recipes).

## Select prizes

| Sponsor | Tracks | Notes for the sponsor questions |
|---|---|---|
| Hedera | Tokenization of Anything; Open Source — Improve the Hedera Harness | ATS factory issuance tx `0xf12ba21d…bcf173`; six Sourcify-verified contracts; harness in `harness/`, upstream PR hedera-dev/hedera-harness#62, ATS issues #1402–#1404; feedback in `docs/FEEDBACK/hedera.md` |
| Chainlink | Best Confidential Workflow; Automated Liquidation Protection Challenge | `workflow/bond-monitor` (handlerInTee, Nitro), deployed as `bond-monitor-production` (first network verdict tx `0xe1bc8a6d…5cb2`); `workflow/liquidation-protection` deployed as `liquidation-protection-production`, `join()` tx `0x22feaf45…64a9` from `0x05406c5D8826E9977eAC63A237B6363DaF02942A`; evidence in `docs/cre-evidence/`; feedback in `docs/FEEDBACK/chainlink.md` |
| Bazantic | Best Recipe that uses EthGlobal Hackathon Sponsor APIs; Agentify a new API | Username **Abhimanyu**; gateways `axuvor5zujgk5hdcydzjdi742m` (Bond Desk), `txrkgk2mezhbln4aeo2tdji6s4` (Hedera Mirror Node testnet), `4q4fqndwcnhxrfk6thlgjnodca` (Bank of Canada Valet, the new API); Recipe <https://bazantic.com/recipes/best-eligible-hedera-bond-recommendation>; test runs `api/bazantic/test-runs-20260912.md`; A/B `docs/bazantic-ab/`; feedback in `docs/FEEDBACK/bazantic.md` |

## Video

Main demo (≤ 4:00) per `docs/DEMO.md`; separate Bazantic recording (3–5 min) per `api/bazantic/dashboard-steps.md`
section 6. Paste the links here once recorded.

## Future

Next: attestation-bound verdicts once CRE exposes an enclave signing primitive; on-chain missed-payment state so
DEFAULT is a grace period rather than a coverage floor; ATS's own corporate-actions module for coupon records with
the Schedule Service as the payer; a second bond and a real issuer on Hedera mainnet with a KYC provider replacing
the testnet officer bot; and the harness PR merged upstream so every Hedera project checks its scheduled
transactions' child results.
