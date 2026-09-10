# Bond Desk / Hedera testnet recommendation — wallet 0x8524F940EddC9EA98198Ee08071944a07C417D7b

Task: recommend the single best corporate bond this wallet can actually hold on Hedera testnet, using only the Bond Desk API and the Hedera Mirror Node REST API. Run label: wallet=kyc, N=2.

## Transcript

### 1. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json
Command: `curl -sS -w "\nHTTP_STATUS:%{http_code}\n" https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json`
Status: **200**
Summary: OpenAPI 3.1.0 spec for "Bond Desk API" (read-only, Hedera testnet). Documents 5 operations: `GET /bonds` (list bonds), `GET /bonds/{id}` (raw terms), `GET /bonds/{id}/orderbook`, `GET /bonds/{id}/risk` (coverage + latest CRE risk verdict: OK/WARN/FREEZE/DEFAULT, with FREEZE explicitly meaning "trading halted (do not recommend)"), `GET /wallets/{address}/eligibility` (checks Hedera-account existence, HBAR-for-gas, and ATS KYC grant per bond — `canHold` false with a reason otherwise), and `GET /healthz`. Server base: `https://wd6nrvmajt.ap-south-1.awsapprunner.com`.

### 2. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds
Command: `curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds"`
Status: **200**
Summary: One bond listed — id `1`, symbol `BDB27`, token `0x0100526434C821d0df24f6CC60352F830F8b4504`, status `Active`, faceValue `1000000`, couponRateBps `500` (5.00%), mark `1000008`, bestBid `0`, bestAsk `990000`, currentYieldBps `505` (5.05%), coverageBps `610` (6.10%).

### 3. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk
Command: `curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk"`
Status: **200**
Summary: `{"bondId":"1","status":"Active","coverageBps":"610","mark":"1000008","lastNonce":"2","blockTime":"1789040705","lastVerdict":{"action":"FREEZE","coverageObserved":"610","nonce":"2","txHash":"0x18d46f9627d0e7808d2c78d73848c5aefd813d73147bd19abc74c8e0573db14e","timestamp":"1789034277"}}` — latest signed CRE risk verdict for bond 1 is **FREEZE** (trading halted per the API's own documentation), driven by low collateral coverage (610 bps ≈ 6.1%).

### 4. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility
Command: `curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility"`
Status: **200**
Summary: `{"address":"0x8524F940EddC9EA98198Ee08071944a07C417D7b","hederaAccount":"0.0.10455958","hbarTinybar":"1000000000","hbarSufficientForGas":true,"tokens":[],"bonds":[{"bondId":"1","token":"0x0100526434C821d0df24f6CC60352F830F8b4504","kycGranted":true,"canHold":true,"reason":"kyc-granted"}]}` — wallet resolves to Hedera account `0.0.10455958`, holds 10 HBAR (sufficient for gas), and is **KYC-granted** on bond 1's token, so `canHold: true` for bond 1.

### 5. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b
Command: `curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b"`
Status: **200**
Summary: Independent cross-check on the Hedera Mirror Node — account `0.0.10455958` exists, `evm_address` `0x8524f940eddc9ea98198ee08071944a07c417d7b` matches the wallet, `balance.balance` = 1,000,000,000 tinybar (10 HBAR), `max_automatic_token_associations: -1` (auto-associates any token), `deleted: false`. Confirms the account is live and funded for gas, matching the Bond Desk eligibility result.

### 6. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455958/tokens
Command: `curl -sS -w "\nHTTP_STATUS:%{http_code}\n" "https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455958/tokens"`
Status: **200**
Summary: `{"tokens":[],"links":{"next":null}}` — the account currently holds no HTS token balances/relationships yet (consistent with not having bought a bond token so far); no KYC-revoked or frozen relationship recorded either, since none exists yet.

## Calls:
1. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json — 200
2. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds — 200
3. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk — 200
4. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility — 200
5. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b — 200
6. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455958/tokens — 200

## Answer:
Wallet 0x8524F940EddC9EA98198Ee08071944a07C417D7b (Hedera account 0.0.10455958, 10 HBAR balance) is technically eligible to hold Bond Desk's only listed bond — BDB27 (bond id 1, mark price 1,000,008 / bestAsk 990,000, currentYieldBps 505 ≈ 5.05% yield, couponRateBps 500) — since the Bond Desk eligibility check reports `canHold: true` with `kycGranted: true` and sufficient HBAR for gas, and the Hedera Mirror Node independently confirms the account exists, is unfunded of any prior tokens, and is funded with 10 HBAR. However, `GET /bonds` and `GET /bonds/1` are the only bond in the marketplace, and `GET /bonds/1/risk` shows its latest on-chain CRE risk verdict is **FREEZE** with collateral coverage of only 610 bps (~6.1%) — the API's own documentation defines FREEZE as "trading halted (do not recommend)". Following the API's documented flow (skip FREEZE/DEFAULT bonds), no bond in the current catalog should be recommended for purchase right now: the one bond this wallet is KYC/eligibility-cleared to hold is presently frozen from trading due to insufficient collateral coverage, so there is no bond this wallet can actually acquire at this time despite passing the KYC/eligibility check.
