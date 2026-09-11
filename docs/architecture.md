# Architecture

Three planes, one signature holds them together:

- **Hedera testnet (chainId 296)** — the bond, the order book, the collateral, the coupon schedule, and the gate
  that accepts risk verdicts.
- **Chainlink CRE** — a confidential workflow that reads Hedera over plain JSON-RPC from inside a TEE, decides
  with thresholds that never leave the enclave, and signs an EIP-712 verdict.
- **Delivery** — a relayer that lands the signed verdict on Hedera, and a Bond API that Bazantic turns into a
  paid, agent-callable service.

## System

```mermaid
flowchart TB
  subgraph HEDERA["Hedera testnet — chainId 296"]
    ATS["ATS bond token<br/>canTransferFrom · getKycStatusFor<br/>snapshots · decimals 0"]
    REG["BondRegistry<br/>terms + status<br/>None/Active/Frozen/Matured/Defaulted"]
    MKT["BondMarket<br/>order book · compliance-gated fill"]
    VAULT["CollateralVault<br/>HBAR collateral (tinybar)<br/>coverageBps"]
    NAV["NavOracle<br/>mark · hbarUsd"]
    FEED["Chainlink HBAR/USD feed<br/>0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a<br/>8 dec · 24h heartbeat"]
    LIFE["BondLifecycle<br/>0xeB363F5aEd5D2a94b41EBF0876bd36864255C956<br/>coupons · pull claims · redeem<br/>holds HBAR: it is the HSS payer"]
    HSS["HSS 0x16b — HIP-1215<br/>scheduleCall, SCHEDULE_GAS 4M"]
    GATE["RiskGate<br/>0x1dFF1d5458D6a6f6af46014de76474DC3170C31B<br/>snapshot() · submit(v,sig) · unfreeze()<br/>EIP-712 verify + nonce"]

    MKT -->|"canTransferFrom"| ATS
    MKT --> REG
    LIFE --> ATS
    LIFE --> HSS
    HSS -.->|"fires payCoupon; contract pays"| LIFE
    LIFE -.->|"the executed call schedules the next coupon"| HSS
    VAULT --> NAV
    NAV -->|"latestRoundData"| FEED
    GATE --> VAULT
    GATE --> NAV
    GATE -->|"setStatus"| REG
  end

  subgraph CRE["Chainlink CRE — confidential workflow (TEE)"]
    CRON["cron trigger<br/>0 */2 * * * *"]
    TEE["handlerInTee"]
    SEC["runtime.getSecrets — one batched call<br/>VERDICT_SIGNER_KEY + WARN/FREEZE/DEFAULT bps"]
    READ["HTTP call 1: JSON-RPC batch<br/>eth_call RiskGate.snapshot(bondId)"]
    DEC["shared/decide.ts — decideBond<br/>coverage ladder, terminal-status guard"]
    SIGN["sign EIP-712 Verdict<br/>key exists only inside the enclave"]
    DON["runtime.usingTheDons().report(digest)<br/>DON attests the run happened"]
    CRON --> TEE --> SEC --> READ --> DEC --> SIGN --> DON
  end

  subgraph SEPOLIA["Sepolia — liquidation challenge"]
    LIQ["liquidation-protection<br/>handlerInTee, 30s cron<br/>batch of 8 reads + an eth_call probe of repay(1)"]
    CHAL["ChallengeLending<br/>0x88574e7Cc0027afd04951daa09B64d4441931ba1<br/>repay · deposit, both behind onlyActive"]
    LIQ -->|"in-enclave signed txs, only when the probe passes"| CHAL
  end

  subgraph DELIVERY["Delivery"]
    RELAY["Relayer (Node + viem)<br/>verifies the signature locally,<br/>skips nonce &le; lastNonce"]
    API["Bond API (Hono)<br/>eth_call live state + mirror-node history"]
    BAZ["Bazantic gateway<br/>x402 · USDC on Base<br/>OpenAPI + MCP tools/list"]
    AGENT["Agent / MCP client<br/>runs the Recipe"]
    MIRROR["Hedera Mirror Node<br/>existing Bazantic service"]
    API --> BAZ --> AGENT
    MIRROR --> BAZ
  end

  READ -.->|"eth_call over HTTPS to hashio"| GATE
  SIGN -->|"VERDICT_JSON — verdict + signature"| RELAY
  RELAY -->|"submit(v, sig) — any address may relay"| GATE
  API --> REG
  API --> MKT
  API --> GATE
  API --> ATS
  DEC -.->|"same module, different policy"| LIQ
```

`decide.ts` is shared by both workflows on purpose: the bond monitor and the liquidation defender are the same
shape of problem — a private threshold, a public observation, a bounded action — and reviewers can read one file
to audit both policies.

## The verdict path

```mermaid
sequenceDiagram
  autonumber
  participant Cron as CRE cron
  participant TEE as bond-monitor (TEE)
  participant RPC as hashio JSON-RPC
  participant DON as CRE DON
  participant Rly as Relayer
  participant GT as RiskGate (Hedera)
  participant MK as BondMarket

  Cron->>TEE: fire (every 2 min)
  TEE->>TEE: getSecrets — signer key + thresholds (1 batched call)
  TEE->>RPC: HTTP 1 — eth_call RiskGate.snapshot(bondId)
  RPC-->>TEE: coverageBps, feedFresh, status, mark, collateral, lastNonce, lastAction, nextCoupon, maturity, timestamp
  alt feedFresh == false
    TEE-->>TEE: log "feed-stale", return without signing
  else fresh
    TEE->>TEE: decideBond(coverageBps, status) -> action + reason
    TEE->>TEE: sign EIP-712 Verdict, nonce = lastNonce + 1
    TEE->>DON: usingTheDons().report(verdict digest)
    TEE-->>Rly: VERDICT_JSON {verdict, signature, chainId 296, riskGate}
    Rly->>Rly: verifyTypedData against RiskGate.signer() — exit before any write if it fails
    Rly->>GT: snapshot(bondId) — skip if nonce <= lastNonce
    Rly->>GT: submit(verdict, signature)
    GT->>GT: recover signer, check nonce and issuedAt freshness
    GT->>GT: on FREEZE set BondRegistry status = Frozen
    GT-->>Rly: VerdictApplied(bondId, action, coverageObserved, nonce, relayer)
    Rly-->>Rly: print txHash + HashScan link
  end
  MK->>MK: next fill reverts BondNotActive while status == Frozen
```

Action codes: `0 OK · 1 WARN · 2 FREEZE · 3 DEFAULT`. Status codes:
`0 None · 1 Active · 2 Frozen · 3 Matured · 4 Defaulted`. `shouldDeliver` suppresses a FREEZE when the bond is
already `Frozen` and a DEFAULT when it is already `Defaulted`, so a repeated verdict does not burn gas;
`decideBond` returns `OK` for `Matured` and `Defaulted` because they are terminal, and for `None`, which means
no such bond — nothing is ever delivered for it. WARN is re-sent on every run
by design — it is a signal, not a state change.

## Why a relay

**Hedera is not a CRE-supported chain.** There is no chain writer, no EVM client target, and no on-chain report
consumer for chainId 296. The workflow therefore does two things a supported chain would hide:

1. **Reads** Hedera as raw JSON-RPC over the CRE HTTP client — one `eth_call` to `RiskGate.snapshot(bondId)`,
   batched into a single HTTP request because the enclave gets five HTTP calls per execution.
2. **Writes** nothing itself in the default configuration. It signs an EIP-712 `Verdict` with a private key that
   exists only as a CRE secret and is only ever materialised inside the enclave, and emits the verdict plus the
   signature as one log line.

That signature is the trust boundary. `RiskGate.submit` recovers the signer and compares it to `signer()`; it
does not care who sent the transaction. So the relayer is a dumb, replaceable, unprivileged courier: it holds a
funded Hedera key that can pay gas and nothing else. Anyone can run one. Losing the relayer key delays verdicts;
it cannot forge one. Replay is closed by the strictly increasing `nonce` (taken from the same snapshot the
decision used) and by an `issuedAt` freshness window.

`bond-monitor` also supports `deliver: "direct"`, where the enclave itself signs a legacy transaction with a
second secret (`HEDERA_SUBMIT_KEY`) and pushes `eth_sendRawTransaction` as its second HTTP call. The relay stays
the default for staging because the intermediate verdict is then inspectable — you can read the JSON, verify the
signature offline, and see exactly what the enclave concluded.

### What stays private, what becomes public

| Private — never leaves the enclave | Public — on-chain or in logs |
|---|---|
| `VERDICT_SIGNER_KEY`, `HEDERA_SUBMIT_KEY` | the signer's **address**, via `RiskGate.signer()` |
| `BOND_WARN_BPS`, `BOND_FREEZE_BPS`, `BOND_DEFAULT_BPS` — the actual policy | the `action` that resulted, and the `coverageObserved` that triggered it |
| the liquidation policy: `LIQ_TRIGGER_HF`, `LIQ_TARGET_HF`, repay/deposit caps, cooldown | the repay and deposit transactions themselves |
| the exact coverage in the workflow's own log line — bucketed to `>=150%` / `120-150%` / `100-120%` / `<100%` | `coverageObserved` in the verdict, because the contract needs it to be auditable |

The asymmetry is the point: an observer can verify **that** the freeze was justified by the coverage the verdict
carries, but cannot learn **where** the thresholds sit and therefore cannot trade against them. That is the
property a public order book cannot give you and a private spreadsheet cannot prove.

Practical consequences worth stating plainly:

- The enclave has secrets but **no signing primitive of its own** — signing is viem's
  `privateKeyToAccount(secret)` inside the TEE. The signature proves the key was used, not that a genuine
  enclave used it. Attestation binding is the missing piece and it is Chainlink's to provide
  (`docs/FEEDBACK/chainlink.md`).
- DEFAULT is a **coverage floor**, not a missed-payment grace period: runs are stateless, so there is nowhere to
  keep "coupon has been late for N days". A real deployment adds that state on-chain.
- Every run costs at most two HTTP calls (one in relay mode), which is what keeps the workflow inside the CRE
  budget with room for a retry.
