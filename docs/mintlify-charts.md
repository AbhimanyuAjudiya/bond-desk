# Chart images for the docs site

Three images, generated in ChatGPT, saved as PNG into `mintlify/images/` with these exact names:

| File | Page it goes on |
|---|---|
| `chart-architecture.png` | How it works → Overview |
| `chart-fill.png` | How it works → The order book |
| `chart-verdict.png` | How it works → Risk verdicts |

Style line to put at the top of every prompt:

> Flat vector-style diagram, white background, dark grey ink, one green accent (#2E7D4F), thin rounded boxes and simple arrows, clean sans-serif labels, no gradients, no 3D, no glow, no decoration, wide 3:2 image. Spell every label exactly as written.

## 1. chart-architecture.png

Flat vector-style diagram, white background, dark grey ink, one green accent (#2E7D4F), thin rounded boxes and simple arrows, clean sans-serif labels, no gradients, no 3D, no glow, no decoration, wide 3:2 image. Spell every label exactly as written.

Draw three large labelled regions side by side. Left region titled "Hedera testnet" containing six small boxes: "ATS bond token (KYC list, control list)", "BondMarket (order book)", "CollateralVault (HBAR collateral)", "BondLifecycle (coupons)", "Hedera Schedule Service", "RiskGate (verdicts)". Inside it draw an arrow from BondMarket to the ATS bond token labelled "canTransferFrom before every fill", a double arrow between BondLifecycle and Hedera Schedule Service labelled "fires payCoupon, schedules the next", and an arrow from RiskGate to CollateralVault labelled "reads coverage". Middle region titled "Chainlink CRE enclave" with one green-outlined box "bond-monitor: private thresholds, signs an EIP-712 verdict". Draw an arrow from the enclave box to RiskGate labelled "signed verdict, every hour". Right region titled "Delivery" with three stacked boxes "JSON API + web app", "Bazantic gateway (x402, MCP)", "AI agents", connected top to bottom by arrows, and an arrow from "JSON API + web app" into the Hedera region labelled "reads live state". Add a small caption under the enclave: "thresholds never leave; the verdict is public".

## 2. chart-fill.png

Flat vector-style diagram, white background, dark grey ink, one green accent (#2E7D4F), thin rounded boxes and simple arrows, clean sans-serif labels, no gradients, no 3D, no glow, no decoration, wide 3:2 image. Spell every label exactly as written.

A left-to-right flowchart of how one trade is judged. Start box: "Buyer clicks Buy on an ask". Then four check boxes in a row, each with a small red exit arrow downward: "Order exists and not expired" (exit label "OrderNotFound / OrderExpired"), "Amount within the order" (exit label "BadAmount"), "Bond is Active" (exit label "BondNotActive"), "Token answers canTransferFrom" (exit label "ComplianceRejected: no KYC, frozen, paused"). Under the fourth box add a small stacked list titled "the token checks, in order": "paused?", "control list?", "KYC of seller and buyer?", "allowance?", "balance?". After the checks, one green box "Settle in one transaction: USDC buyer to seller, bonds seller to buyer". All red exits point to one grey box at the bottom: "Reverts. Nothing moves. The app shows the reason before you sign."

## 3. chart-verdict.png

Flat vector-style diagram, white background, dark grey ink, one green accent (#2E7D4F), thin rounded boxes and simple arrows, clean sans-serif labels, no gradients, no 3D, no glow, no decoration, wide 3:2 image. Spell every label exactly as written.

Two parts. Left part: a vertical ladder titled "Coverage ladder (thresholds are private)" with four stacked bands from top to bottom labelled "OK", "WARN", "FREEZE", "DEFAULT", the top band green, the bottom band grey, and a small pointer on the right of the ladder labelled "coverage observed" pointing into the FREEZE band. Right part: a horizontal sequence of five boxes connected by arrows: "Every hour: enclave reads coverage", "Compares with the private ladder", "Signs an EIP-712 verdict (bond, action, coverage observed, time, nonce)", "RiskGate checks the signer, the nonce and freshness", "FREEZE: the bond is Frozen, fills are refused". Under the last box a small note: "the admin can unfreeze; the next hour decides again". Under the whole sequence one line: "public: the verdict and the coverage it saw. private: where the lines sit."
