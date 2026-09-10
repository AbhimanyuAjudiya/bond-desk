# Recipe run: Best eligible Hedera bond for a wallet

wallet = 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3
run = 1 (label: nokyc)
date = 2026-09-10

BOND_DESK = https://wd6nrvmajt.ap-south-1.awsapprunner.com
MIRROR = https://testnet.mirrornode.hedera.com/api/v1

## 0. Discover Bond Desk endpoints

**GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json**
Status: 200
Summary: OpenAPI doc confirms paths: `GET /bonds`, `GET /bonds/{id}`, `GET /bonds/{id}/orderbook`,
`GET /bonds/{id}/risk`, `GET /wallets/{address}/eligibility`, `GET /healthz`.

## 1. Does the wallet exist on Hedera?

**GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3**
Status: 200
Summary: Account exists — Hedera id `0.0.10455959`, evm_address matches, balance.balance = 994818742
tinybar (~9.948 HBAR, above the 1e8 tinybar / 1 HBAR gas floor). Not terminal — proceed.

## 2. Can it pay for gas, and what does it already hold?

**GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/tokens?limit=100**
Status: 200
Summary: `{"tokens":[],"links":{"next":null}}` — wallet holds zero HTS tokens today. HBAR balance
(994818742 tinybar) is above the 1e8 tinybar floor, so no gas warning needed.

## 3. What is this wallet allowed to hold?

**GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/eligibility**
Status: 200
Summary: Response body:
```json
{"address":"0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3","hederaAccount":"0.0.10455959","hbarTinybar":"994818742","hbarSufficientForGas":true,"tokens":[],"bonds":[{"bondId":"1","token":"0x0100526434C821d0df24f6CC60352F830F8b4504","kycGranted":false,"canHold":false,"reason":"no-kyc"}]}
```
Only one bond is listed (bondId `1`), and it has `canHold: false`, `reason: "no-kyc"`. The `canHold: true`
set is **empty**.

## Stop condition reached

Per the Recipe: "If nothing has `canHold: true`, stop and explain the reasons; do not recommend a bond the
wallet cannot buy." No candidates survive step 3, so steps 4 (`GET /bonds`) and 5 (`GET /bonds/{id}/risk`)
are not run — there is nothing to rank or risk-check.

## Calls made (method + full URL, in order)

1. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json — 200
2. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3 — 200
3. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/tokens?limit=100 — 200
4. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/eligibility — 200

## Answer

Wallet `0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3` (Hedera account `0.0.10455959`) has a funded Hedera
testnet account (~9.95 HBAR, comfortably above the ~1 HBAR gas floor) and holds no HTS tokens, but it
**cannot buy any bond right now**. The Bond Desk eligibility check returns exactly one bond in scope
(bond id `1`, token `0x0100526434C821d0df24f6CC60352F830F8b4504`) and marks it `canHold: false` with
`reason: "no-kyc"` — the wallet has not been KYC'd by the bond's transfer agent. There are no other
bonds listed as in-scope for this wallet, so the eligible set is empty and no yield/price ranking or
risk check was performed (steps 4-5 of the Recipe are skipped per its own stop condition). To proceed,
the wallet holder needs to complete the issuer's KYC/ATS onboarding for bond id 1 (or any other bond)
before a purchase can be recommended.
