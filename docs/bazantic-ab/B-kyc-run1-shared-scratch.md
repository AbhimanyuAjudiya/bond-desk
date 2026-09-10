# Recipe run: Best eligible Hedera bond for a wallet
wallet=kyc (address 0x8524F940EddC9EA98198Ee08071944a07C417D7b), run=1
date: 2026-09-10

## Command log

### 1. Fetch Bond Desk OpenAPI document (to discover real endpoint paths/base URL)
```
curl -sS -o openapi.json -w "HTTP_STATUS:%{http_code}\n" https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json
```
Result: `HTTP_STATUS:200`
Summary: OpenAPI doc for "Bond Desk API", server `https://wd6nrvmajt.ap-south-1.awsapprunner.com`, paths: `/bonds`, `/bonds/{id}`, `/bonds/{id}/orderbook`, `/bonds/{id}/risk`, `/healthz`, `/wallets/{address}/eligibility`.

### 2. Step 1 of recipe — does the wallet exist on Hedera?
```
curl -sS -o mirror_account.json -w "HTTP_STATUS:%{http_code}\n" "https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b"
```
Result: `HTTP_STATUS:200`
Summary: Account exists — Hedera id `0.0.10455958`, evm_address `0x8524f940eddc9ea98198ee08071944a07c417d7b`, `balance.balance` = `1000000000` tinybar (= 10 HBAR), balance timestamp `1789029676.901517104`. Not terminal, proceed.

### 3. Step 2 of recipe — token holdings / gas floor
```
curl -sS -o mirror_tokens.json -w "HTTP_STATUS:%{http_code}\n" "https://testnet.mirrornode.hedera.com/api/v1/accounts/0x8524F940EddC9EA98198Ee08071944a07C417D7b/tokens?limit=100"
```
Result: `HTTP_STATUS:200`
Summary: `{"tokens":[],"links":{"next":null}}` — wallet holds zero HTS tokens. HBAR balance (1,000,000,000 tinybar) is well above the 1e8-tinybar (1 HBAR) gas floor, so no low-balance warning applies.

### 4. Step 3 of recipe — what is this wallet allowed to hold?
```
curl -sS -o eligibility.json -w "HTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility"
```
Result: `HTTP_STATUS:200`
Raw body:
```json
{"address":"0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3","hederaAccount":"0.0.10455959","hbarTinybar":"994818742","hbarSufficientForGas":true,"tokens":[],"bonds":[{"bondId":"1","token":"0x0100526434C821d0df24f6CC60352F830F8b4504","kycGranted":false,"canHold":false,"reason":"no-kyc"}]}
```
Summary: Only one bond entry returned (bond id `1`), with `canHold: false`, `reason: "no-kyc"`, `kycGranted: false`. No entries with `canHold: true`.

Note (factual, not acted on): the response's own `address` (`0x3b44...b31cb3`) and `hederaAccount` (`0.0.10455959`) fields do not match the queried wallet or the Hedera account resolved in call 2 (`0.0.10455958`). Verified with `curl -v` that the request path sent was exactly `/wallets/0x8524F940EddC9EA98198Ee08071944a07C417D7b/eligibility` and the response is stable/repeatable. Regardless of that mismatch, the `bonds[].canHold` verdict returned for this call is `false` for the only bond in the system, which per the recipe (step 3) is a terminal empty `canHold:true` set — no eligibility recheck endpoint exists in the OpenAPI spec to resolve the discrepancy.

### 5. Step 4 of recipe — bond universe (for context, since step 3 already terminates)
```
curl -sS -o bonds.json -w "HTTP_STATUS:%{http_code}\n" "https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds"
```
Result: `HTTP_STATUS:200`
Summary: One bond exists in the whole system: `id=1`, symbol `BDB27`, `status=Active`, `currentYieldBps=505` (5.05%), `bestAsk=990000`, `coverageBps=610` (6.10%). This is the same bond `1` that eligibility marked `canHold:false` / `no-kyc` for this wallet.

Step 5 (per-bond risk check) and step 6 (recommendation) were not executed — the recipe's failure mode "Empty `canHold` set in step 3" applies, so no bond may be recommended regardless of its risk/yield numbers.

## Result

Per the recipe's explicit rule ("If nothing has `canHold: true`, stop and explain the reasons; do not recommend a bond the wallet cannot buy"), this run terminates at step 3.
