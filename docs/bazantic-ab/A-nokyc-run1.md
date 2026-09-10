# Bond Desk task — wallet 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3 (run label: nokyc, N=1)

## 1. Fetch Bond Desk OpenAPI spec
**GET** https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json
- HTTP status: 200
- Summary: OpenAPI 3.1 doc for "Bond Desk API" (read-only, Hedera testnet). Operations: `listBonds` (GET /bonds), `getBond` (GET /bonds/{id}), `getOrderbook` (GET /bonds/{id}/orderbook), `getBondRisk` (GET /bonds/{id}/risk), `getWalletEligibility` (GET /wallets/{address}/eligibility), `healthz`. Doc's own recommended agent flow: listBonds -> getWalletEligibility -> getBondRisk -> answer.
- Key schema notes: `Eligibility.bonds[]` gives `canHold` (bool) and `reason` (enum: kyc-granted, no-kyc, no-hedera-account, bond-not-active) per bond. `canHold` is true only when the Hedera account exists, ATS KYC is granted on the bond token, and the bond status is Active.

## 2. List all bonds
**GET** https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds
- HTTP status: 200
- Summary: 1 bond registered — id "1", symbol BDB27, status "Active", faceValue 1,000,000 (settlement base units), couponRateBps 500 (5%), bestBid "0" (no open bid), bestAsk "990000", currentYieldBps "505" (5.05%), coverageBps "610" (6.10% collateral coverage), mark "1000008".

## 3. Wallet eligibility (all bonds) for 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3
**GET** https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/eligibility
- HTTP status: 200
- Summary: `hederaAccount`: "0.0.10455959" (account exists). `hbarTinybar`: "994818742" (~9.95 HBAR). `hbarSufficientForGas`: true. `tokens`: [] (no HTS token balances/associations). `bonds`: [{ bondId "1", token 0x0100526434C821d0df24f6CC60352F830F8b4504, `kycGranted`: false, `canHold`: false, `reason`: "no-kyc" }].

## 4. Bond risk snapshot for bond id 1
**GET** https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk
- HTTP status: 200
- Summary: status "Active", coverageBps "610" (6.10%, i.e. low collateral coverage), mark "1000008", lastNonce "2". `lastVerdict`: action "FREEZE" (a historical CRE risk verdict recorded at nonce 2, timestamp 1789034277) even though the bond's live status field currently reads "Active".

## 5. Cross-check account directly on Hedera Mirror Node (testnet)
**GET** https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3
- HTTP status: 200
- Summary: Confirms account "0.0.10455959" exists, evm_address matches (lowercased), balance.balance = 994818742 tinybar (~9.95 HBAR, matches Bond Desk API), balance.tokens = [] (no HTS token associations — consistent with no KYC/association on the bond token). Account created_timestamp 1789029692, not deleted.

## Conclusion
Only one bond exists on this Bond Desk deployment (id 1, BDB27). The wallet has a funded Hedera account with sufficient HBAR for gas, but `getWalletEligibility` reports `canHold: false, reason: "no-kyc"` for bond 1 — it has not been granted ATS KYC on the bond token, confirmed independently by the Mirror Node showing zero token associations for this account. Per the API's own guidance, a fill for a non-KYC wallet reverts on-chain, so no purchase should be recommended.

---

## Calls:
1. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json — 200
2. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds — 200
3. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/eligibility — 200
4. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk — 200
5. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3 — 200

## Answer:
Wallet 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3 cannot hold any corporate bond on this Bond Desk deployment right now. The only bond listed, id 1 (symbol BDB27, Active, currentYieldBps 505 = 5.05% yield, bestAsk 990000 settlement base units per whole bond token), was checked via getWalletEligibility, which returned `canHold: false, reason: "no-kyc"` for this wallet on that bond — the wallet's Hedera account (0.0.10455959) exists and holds enough HBAR for gas (~9.95 HBAR, hbarSufficientForGas: true), but it has not been granted ATS KYC on the bond's token, independently confirmed by the Mirror Node showing zero token associations on the account. Per the Bond Desk API's own guidance, a fill for a non-KYC wallet reverts on-chain, so no bond purchase can be recommended until this wallet obtains KYC approval on the BDB27 bond token (0x0100526434C821d0df24f6CC60352F830F8b4504).
