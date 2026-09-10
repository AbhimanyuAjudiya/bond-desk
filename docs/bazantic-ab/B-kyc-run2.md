# Recipe run — Best eligible Hedera bond for a wallet

- Wallet: `0x8524F940EddC9EA98198Ee08071944a07C417D7b`
- Run label: kyc / run 2
- BOND_DESK base (resolved from openapi.json `servers[0].url`): `https://wd6nrvmajt.ap-south-1.awsapprunner.com`
- MIRROR base: `https://testnet.mirrornode.hedera.com/api/v1`

## Step 0 — Discover Bond Desk API shape

`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json`
Status: 200
Summary: OpenAPI doc; server url `https://wd6nrvmajt.ap-south-1.awsapprunner.com`; paths `GET /bonds`, `GET /bonds/{id}`, `GET /bonds/{id}/orderbook`, `GET /bonds/{id}/risk`, `GET /wallets/{address}/eligibility`, `GET /healthz`.

## Step 1 — Does the wallet exist on Hedera?

`GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b`
Status: 200
Summary: Account exists — Hedera id `0.0.10455958`, evm_address matches, `balance.balance = 1000000000` tinybar (= 10 HBAR).

Not terminal (200, not 404) — continue.

## Step 2 — Can it pay for gas / what does it hold?

`GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b/tokens?limit=100`
Status: 200
Summary: `tokens: []` — wallet holds no HTS tokens yet. HBAR balance (1,000,000,000 tinybar = 10 HBAR) is well above the 1e8-tinybar (1 HBAR) gas floor, so no low-balance warning applies.

## Step 3 — What is this wallet allowed to hold?

`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility`
Status: 200
Summary: `hbarSufficientForGas: true`. One bond entry: bondId `1`, `kycGranted: true`, `canHold: true`, `reason: "kyc-granted"`. No excluded bonds returned by this endpoint — the wallet is KYC'd on the one bond in the system.

Kept candidate set: `{ "1" }`. Non-empty — continue.

## Step 4 — Which of those is the best buy?

`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds`
Status: 200
Summary: One bond total in the system — id `1`, symbol `BDB27`, `status: "Active"`, `currentYieldBps: 505`, `bestAsk: 990000` (non-zero, there is an ask to lift), `coverageBps: 610`, token `0x0100526434C821d0df24f6CC60352F830F8b4504`, HashScan link `https://hashscan.io/testnet/contract/0x0100526434C821d0df24f6CC60352F830F8b4504`.

Restricted to kept candidates from step 3: only bond `1` qualifies, so it is trivially the top-ranked (Active status, non-zero ask) candidate.

## Step 5 — Is the top candidate safe to recommend right now?

`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk`
Status: 200
Summary: `status: "Active"`, `coverageBps: 610`, `lastVerdict: { action: "FREEZE", coverageObserved: 610, nonce: 2, timestamp: 1789034277 }`.

Per recipe rule: `status == "Active"` with a FREEZE verdict on record means the freeze has since been lifted — bond `1` is still recommendable, but the answer must disclose that the risk monitor froze it at nonce 2 and quote current coverage.

## Calls

1. `GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json` → 200 — OpenAPI spec, resolved Bond Desk base URL and 5 endpoints.
2. `GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b` → 200 — account `0.0.10455958` exists, balance 1,000,000,000 tinybar (10 HBAR).
3. `GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b/tokens?limit=100` → 200 — no HTS tokens held yet.
4. `GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility` → 200 — canHold=true only on bond id 1 (kyc-granted).
5. `GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds` → 200 — one bond in system: id 1 / BDB27, Active, yield 505 bps, bestAsk 990000, coverage 610 bps.
6. `GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk` → 200 — status Active, coverage 610 bps, lastVerdict FREEZE at nonce 2 (historical, since lifted).

## Answer

Wallet `0x8524F940EddC9EA98198Ee08071944a07C417D7b` (Hedera account `0.0.10455958`, 10 HBAR on hand — comfortably above the ~1 HBAR gas floor) can hold bond **BDB27 (id 1)**: it is the only bond in the Bond Desk's book, and the wallet is KYC-cleared for it (`canHold: true`, `reason: kyc-granted`). BDB27 is currently **Active**, yielding **5.05%** (`currentYieldBps` 505) with a best ask of **990000 settlement units** per whole bond token, and collateral coverage of **6.10%** (`coverageBps` 610). Its risk record carries a **FREEZE** verdict from nonce 2, but since the bond's live `status` is `Active`, that freeze has since been lifted — it's disclosed here as history, not a current block. Token contract on HashScan: https://hashscan.io/testnet/contract/0x0100526434C821d0df24f6CC60352F830F8b4504. No bonds were excluded in steps 3–5 (BDB27 is the only bond that exists, and it passed eligibility and risk). No HBAR-balance warning applies — the wallet's 10 HBAR is well above the ~1 HBAR gas floor.
