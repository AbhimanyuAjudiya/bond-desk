# Transcript — B-kyc-run1 (wallet=kyc, N=1, isolated re-run)

Wallet: `0x8524F940EddC9EA98198Ee08071944a07C417D7b`
Recipe followed: `/Users/abhimanyu/Desktop/ethGlobal/api/bazantic/recipe.md` ("Best eligible Hedera bond for a wallet")
Bases used (as given in task, not the gateway.md bazgateway slugs):
- BOND_DESK = https://wd6nrvmajt.ap-south-1.awsapprunner.com
- MIRROR = https://testnet.mirrornode.hedera.com/api/v1

All raw responses saved alongside this file: `openapi.json`, `step1_account.json`, `step2_tokens.json`, `step3_eligibility.json`, `step4_bonds.json`, `step5_risk.json`.

## Commands run, in order

### 0. Discover Bond Desk API shape
```
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json" -o openapi.json
```
HTTP 200. Summary: OpenAPI doc confirms paths `/bonds`, `/bonds/{id}`, `/bonds/{id}/orderbook`, `/bonds/{id}/risk`, `/wallets/{address}/eligibility`, `/healthz`.

### 1. Does the wallet exist on Hedera? (Recipe step 1)
```
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b" -o step1_account.json
```
HTTP 200. Summary: account exists as Hedera id `0.0.10455958`, balance.balance = 1,000,000,000 tinybar (10 HBAR). Not terminal — proceed.

### 2. Can it pay for gas / what does it hold? (Recipe step 2)
```
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b/tokens?limit=100" -o step2_tokens.json
```
HTTP 200. Summary: `tokens: []` — wallet holds no HTS tokens yet. HBAR balance (1e9 tinybar) is above the 1e8-tinybar (1 HBAR) floor, so no gas warning applies.

### 3. What is this wallet allowed to hold? (Recipe step 3)
```
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility" -o step3_eligibility.json
```
HTTP 200. Summary: one bond entry, `bondId "1"`, `kycGranted: true`, `canHold: true`, `reason: "kyc-granted"`. No excluded entries were returned (the eligibility list contains only this one bond, already eligible).

### 4. Which of those is the best buy? (Recipe step 4)
```
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds" -o step4_bonds.json
```
HTTP 200. Summary: exactly one bond exists in the whole book: id `1`, symbol `BDB27`, `status: "Active"`, `currentYieldBps: 505`, `bestAsk: 990000` (nonzero — an ask exists), `coverageBps: 610`. Restricting to canHold ids from step 3 ({1}) and to Active status leaves only bond 1; no ranking/tie-break needed since it is the sole candidate.

### 5. Is the top candidate safe to recommend right now? (Recipe step 5)
```
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk" -o step5_risk.json
```
HTTP 200. Summary: `status: "Active"` (not Frozen/Matured/Defaulted — not disqualified). `coverageBps: 610`. `lastVerdict.action: "FREEZE"`, `lastVerdict.nonce: "2"` — a freeze was recorded historically but `status` is currently `Active`, so per the Recipe this is still recommendable; the answer must disclose the prior freeze and current coverage.

## Calls:

1. `GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json` → 200
2. `GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b` → 200
3. `GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b/tokens?limit=100` → 200
4. `GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility` → 200
5. `GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds` → 200
6. `GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk` → 200

## Answer:

Wallet `0x8524F940EddC9EA98198Ee08071944a07C417D7b` has a live Hedera testnet account (`0.0.10455958`, 10 HBAR — comfortably above the ~1 HBAR gas floor) and holds no tokens yet. The Bond Desk eligibility check shows KYC has been granted on exactly one bond, and that bond is also the only one in the entire book — so it wins by default, not by comparison. Recommend **BDB27 (bond id 1)**: current yield **5.05%** (505 bps), best ask **990,000 settlement units per whole bond token**, collateral coverage **6.10%** (610 bps), on-chain status **Active**. Note for transparency: the risk monitor recorded a **FREEZE verdict at nonce 2** in the past, but the bond's live status is Active, meaning that freeze has since been lifted — it is still safe to recommend under the Recipe's rules, just worth disclosing. Token contract on HashScan: https://hashscan.io/testnet/contract/0x0100526434C821d0df24f6CC60352F830F8b4504. Nothing was excluded in steps 3–5 (no other bonds exist to exclude), and no HBAR-balance warning applies since the wallet's balance is well above the 1 HBAR floor.
