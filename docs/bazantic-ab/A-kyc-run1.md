# Bond Desk / Hedera testnet — corporate bond eligibility check

Wallet: `0x8524F940EddC9EA98198Ee08071944a07C417D7b`
Run: wallet=kyc, N=1
Date: 2026-09-10

## Transcript

### 1. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json
- HTTP 200
- Summary: OpenAPI 3.1 doc for "Bond Desk API". Operations: `listBonds` (GET /bonds), `getBond` (GET /bonds/{id}), `getOrderbook` (GET /bonds/{id}/orderbook), `getBondRisk` (GET /bonds/{id}/risk), `getWalletEligibility` (GET /wallets/{address}/eligibility), `healthz` (GET /healthz). Description states the intended agent flow: listBonds → getWalletEligibility → getBondRisk (skip FREEZE/DEFAULT) → answer. Notes: prices are settlement-token base units per whole bond token; bps=basis points; only `status=="Active"` bonds are tradable.

### 2. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds
- HTTP 200
- Summary: Returned exactly one bond — id `1`, symbol `BDB27`, status `Active`, faceValue 1,000,000, couponRateBps 500, mark 1,000,008, coverageBps 610, bestBid 0, bestAsk 990,000, currentYieldBps 505.

### 3. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility?bondId=1
- HTTP 200
- Summary: Wallet resolves to Hedera account `0.0.10455958`, hbarTinybar 1,000,000,000 (10 HBAR), `hbarSufficientForGas: true`. For bond 1: `kycGranted: true`, `canHold: true`, reason `kyc-granted`.

### 4. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk
- HTTP 200
- Summary: bond 1 `status: "Active"`, `coverageBps: "610"` (6.10% collateral coverage), `lastVerdict.action: "FREEZE"` (coverageObserved 610, nonce 2, signed at unix 1789034277). Per the API's own interpretation guide, a FREEZE verdict means "trading halted — do not recommend."

### 5. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1
- HTTP 200
- Summary: Same summary fields as #2 plus raw `terms`: issuer `0xe7F5773A3d8f3dF15FE4474637cCCCF79d2CD3D6`, bondDecimals 0, settlementDecimals 6, maturity 1820569075, raw `status: 1` (Active).

### 6. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/orderbook
- HTTP 200
- Summary: bestBid 0 / bestAsk 990,000. One open ask: orderId 1, maker `0xe7F5773A3d8f3dF15FE4474637cCCCF79d2CD3D6`, amount 10, price 990,000, expiry 1789638566. One historical trade at the same price/amount. No bids.

### 7. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455958
- HTTP 200
- Summary: Confirms Hedera account `0.0.10455958` exists, `evm_address: 0x8524f940eddc9ea98198ee08071944a07c417d7b` (matches the wallet, case-insensitive), `balance.balance: 1000000000` tinybar (10 HBAR), not deleted. Corroborates Bond Desk API's eligibility figures independently.

### 8. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455958/tokens
- HTTP 200
- Summary: `tokens: []` — no native HTS token associations. Consistent with the bond token being an EVM/ATS smart-contract token (address `0x0100526434C821d0df24f6CC60352F830F8b4504` is not a long-zero HTS address) whose KYC allowlist is enforced by the contract itself, not by Hedera-native token KYC — so this does not contradict `kycGranted: true` from the Bond Desk API.

### 9. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/healthz
- HTTP 200
- Summary: `ok: true`, chainId 296 (Hedera testnet), latest block 40,340,988 — API's upstream Hedera RPC is healthy, so the above data is fresh, not stale-upstream data.

## Calls:
1. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json — 200
2. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds — 200
3. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility?bondId=1 — 200
4. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/risk — 200
5. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1 — 200
6. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1/orderbook — 200
7. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455958 — 200
8. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10455958/tokens — 200
9. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/healthz — 200

## Answer:

Wallet `0x8524F940EddC9EA98198Ee08071944a07C417D7b` (Hedera account `0.0.10455958`) is **KYC-eligible and technically able to hold** the only corporate bond currently listed, `BDB27` (bond id 1, price/ask 990,000 settlement-base-units per token, currentYieldBps 505 ≈ 5.05%) — it has a live Hedera account, 10 HBAR (sufficient for gas), and `kycGranted: true` / `canHold: true` for that bond, all independently confirmed against the Hedera testnet mirror node. However, this bond cannot be recommended: `GET /bonds/1/risk` shows its collateral coverage at only 610 bps (6.10% of face value, far below the 10,000 bps/100% healthy threshold) and its most recent Chainlink CRE risk verdict is `FREEZE` — which, per the Bond Desk API's own guidance, means trading should be treated as halted and the bond should not be recommended, regardless of the summary `status` field still reading "Active". Since `BDB27` is the **only** bond `/bonds` returns, there is currently no corporate bond on this Bond Desk that the wallet can be recommended to buy: eligibility is not the blocker — the bond's own risk state is.
