# Bond purchase feasibility check — wallet 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3

Run label: nokyc / run2

## Transcript

### 1. Discover Bond Desk API operations
`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json`
Status: 200
Summary: OpenAPI 3 doc, title "Bond Desk API" v1.0.0. Operations: `GET /bonds` (list), `GET /bonds/{id}` (detail), `GET /bonds/{id}/orderbook`, `GET /bonds/{id}/risk`, `GET /wallets/{address}/eligibility`, `GET /healthz`. Docs explicitly say: filter `status=='Active'` before recommending, sort by `currentYieldBps` desc, then call `getWalletEligibility` before telling a user to buy (a fill for a non-KYC wallet reverts on-chain).

### 2. List all bonds
`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds`
Status: 200
Summary: One bond registered — id `1`, symbol `BDB27`, status `Active`, faceValue 1,000,000, couponRateBps 500, currentYieldBps 505 (5.05%), coverageBps 610 (6.10% collateral coverage), bestBid `0` (no bids), bestAsk `990000`.

### 3. Wallet eligibility for this bond
`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/eligibility`
Status: 200
Summary: `hederaAccount` = `0.0.10455959`, `hbarTinybar` = 994818742 (~9.95 HBAR), `hbarSufficientForGas` = true, `tokens` = []. For bond `1`: `kycGranted` = false, `canHold` = false, `reason` = "no-kyc".

### 4. Bond 1 risk snapshot
`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk`
Status: 200
Summary: `status` = "Active", `coverageBps` = 610, `mark` = 1000008. `lastVerdict`: action = "FREEZE", coverageObserved = 610, nonce 2, timestamp 1789034277 — i.e., the most recent on-chain risk verdict from the Chainlink CRE enclave was a FREEZE call at 6.10% coverage (well under 100%).

### 5. Bond 1 orderbook
`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/orderbook`
Status: 200
Summary: `bestBid` = 0 (no buyers), one open ask: orderId 1, maker `0xe7F5...D3D6`, amount 10, price 990000. One historical fill (trade) between the same maker and a different taker at price 990000.

### 6. Bond 1 raw terms
`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1`
Status: 200
Summary: Same summary fields plus `terms`: issuer `0xe7F5773A3d8f3dF15FE4474637cCCCF79d2CD3D6`, bondDecimals 0, settlementDecimals 6, maturity 1820569075, nextCoupon 1789121682, terms.status = 1 (Active).

### 7. Cross-check wallet on Hedera mirror node (testnet)
`GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3`
Status: 200
Summary: Confirms EVM address maps to Hedera account `0.0.10455959`, `balance.balance` = 994818742 tinybar (~9.95 HBAR, funded), `deleted` = false, `evm_address` matches (lowercased), account created at consensus time 1789029692.939053894.

### 8. Cross-check token associations on mirror node
`GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455959/tokens`
Status: 200
Summary: `tokens` = [] — the account holds/is associated with zero HTS tokens, independently confirming it is not KYC-granted/associated with the BDB27 bond token (`0x0100526434C821d0df24f6CC60352F830F8b4504`).

## Calls:
1. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json → 200
2. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds → 200
3. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/eligibility → 200
4. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk → 200
5. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/orderbook → 200
6. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1 → 200
7. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3 → 200
8. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455959/tokens → 200

## Answer:
Wallet 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3 (Hedera account 0.0.10455959) cannot hold any corporate bond on this desk right now. There is exactly one bond listed, BDB27 (id 1, Active status, yield 5.05% / 505 bps, best ask price 990000 per unit, face value 1,000,000, collateral coverage only 6.10% with the most recent risk verdict a FREEZE at that coverage level), and the Bond Desk eligibility check returns canHold=false with reason "no-kyc" for this wallet against that bond. The wallet does exist on Hedera testnet and has sufficient HBAR for gas (~9.95 HBAR, confirmed independently via the mirror node), but it holds zero token associations and is not KYC-granted on the bond's ATS token — the mirror node's own token list for the account is empty, corroborating the Bond Desk verdict. Since a fill for a non-KYC wallet reverts on-chain, no purchase should be recommended until the wallet obtains a KYC grant on token 0x0100526434C821d0df24f6CC60352F830F8b4504 (and, separately, the bond's collateral coverage/FREEZE verdict would also need to be resolved before this bond is safe to buy).
