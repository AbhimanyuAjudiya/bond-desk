# Recipe run: Best eligible Hedera bond for a wallet

- Wallet: 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3
- Run label: nokyc, run 2
- BOND_DESK base (resolved from openapi.json `servers[0].url`): https://wd6nrvmajt.ap-south-1.awsapprunner.com
- MIRROR base: https://testnet.mirrornode.hedera.com/api/v1

## Preliminary: resolve Bond Desk base URL

`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json`
Status: 200
Summary: OpenAPI doc confirms server `https://wd6nrvmajt.ap-south-1.awsapprunner.com` and paths `/bonds`, `/bonds/{id}`, `/bonds/{id}/orderbook`, `/bonds/{id}/risk`, `/wallets/{address}/eligibility`, `/healthz`.

## Step 1 — Does the wallet exist on Hedera?

`GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3`
Status: 200
Summary: Account exists — Hedera id `0.0.10455959`, balance `994818742` tinybar (~9.948 HBAR), 0 associated tokens in this payload.

Not terminal (200, not 404) — continue.

## Step 2 — Can it pay for gas, and what does it already hold?

`GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/tokens?limit=100`
Status: 200
Summary: `{"tokens":[],"links":{"next":null}}` — wallet holds no Hedera tokens yet. HBAR balance (994818742 tinybar) is above the 1e8 tinybar (1 HBAR) gas-floor, so no low-balance warning applies.

## Step 3 — What is this wallet allowed to hold?

`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/eligibility`
Status: 200
Summary: One bond listed — bond id `1`, token `0x0100526434C821d0df24f6CC60352F830F8b4504`, `kycGranted: false`, `canHold: false`, `reason: "no-kyc"`. No entries with `canHold: true`.

Per recipe: empty `canHold` set → stop here. Do not call `/bonds` or `/bonds/{id}/risk` for a recommendation, and do not recommend any bond.

## Context lookup (not part of the eligibility gate, used only to name the excluded bond for the answer)

`GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1`
Status: 200
Summary: Bond `1` = symbol `BDB27`, status `Active`, issuer `0xe7F5773A3d8f3dF15FE4474637cCCCF79d2CD3D6`, currentYieldBps `505`, bestAsk `990000`, coverageBps `610`. Confirms the only bond in the eligibility list is BDB27; not used to override the KYC gate.

## Calls:

1. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/openapi.json → 200
2. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3 → 200
3. GET https://testnet.mirrornode.hedera.com/api/v1/accounts/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/tokens?limit=100 → 200
4. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/wallets/0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3/eligibility → 200
5. GET https://wd6nrvmajt.ap-south-1.awsapprunner.com/bonds/1 → 200 (context only, not part of the eligibility gate)

## Answer:

Wallet 0x3b44299d9F246dc775DC2e4A0B54e31DB5b31cb3 has a Hedera testnet account (0.0.10455959) with 994,818,742 tinybar (~9.95 HBAR), comfortably above the ~1 HBAR gas floor, and holds no tokens yet — so it can pay for a transaction, but it cannot hold any bond right now. The Bond Desk eligibility check lists exactly one bond, BDB27 (bond id 1, token 0x0100526434C821d0df24f6CC60352F830F8b4504, issuer 0xe7F5773A3d8f3dF15FE4474637cCCCF79d2CD3D6), and marks it canHold: false, reason "no-kyc" (kycGranted: false). No other bonds appear in this wallet's eligibility list, so the set of bonds with canHold: true is empty. Per the recipe, this is terminal: I am not recommending a bond, since none can currently be bought. The wallet needs to complete the issuer's KYC/ATS onboarding for BDB27 (id 1) before its eligibility flips to canHold: true; only then would it make sense to re-run steps 4–5 (compare active bonds by yield/ask, then check the risk status) to pick a bond to buy.
