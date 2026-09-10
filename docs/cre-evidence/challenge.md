# Automated Liquidation Protection Challenge — participation record

Network: Ethereum Sepolia (11155111). Challenge contract `0x88574e7Cc0027afd04951daa09B64d4441931ba1`,
vETH `0x5dED1a40c3D56dA42E7f932f781c0432556c9814`, vUSD `0x6Fe92Ead5299040f50F095860b5A0A7A2D4041A2`.

Participant wallet (the workflow's `LIQ_WALLET_KEY` / `CRE_ETH_PRIVATE_KEY`):
`0x05406c5D8826E9977eAC63A237B6363DaF02942A`

| Step | Tx |
|---|---|
| approve vUSD (max) | [`0x254d6b409d2cf03060e6bf20e23dafbad0f0c52ea6ddfba758d17db3c93da193`](https://sepolia.etherscan.io/tx/0x254d6b409d2cf03060e6bf20e23dafbad0f0c52ea6ddfba758d17db3c93da193) |
| approve vETH (max) | [`0x03bb99bfa1e85d9faccd15a6ec3679471ec588249f7cdcff7f29644ea5f3b74a`](https://sepolia.etherscan.io/tx/0x03bb99bfa1e85d9faccd15a6ec3679471ec588249f7cdcff7f29644ea5f3b74a) |
| `join()` | [`0x22feaf45d88d5ffada8b10a55a4561e605326218d592d26d81e52e1977fe64a9`](https://sepolia.etherscan.io/tx/0x22feaf45d88d5ffada8b10a55a4561e605326218d592d26d81e52e1977fe64a9) |

Position right after `join()`: collateral 5.00 vETH, debt 7,000.00 vUSD, vETH price 2,000.00, health factor 1.11
(`getUserPosition` = `(500, 700000, 111, 0, 1789030524, 0)`).

Produced by `bun run setup:challenge` (`workflow/scripts/setup-challenge.ts`) on 2026-09-10.
Workflow: `workflow/liquidation-protection/main.ts`; simulation logs in this directory; deployment record appended below once
`cre workflow deploy liquidation-protection --target staging-settings` has run.

## Simulation runs (CRE CLI, local simulator)

| Log | What it shows |
|---|---|
| `liquidation-protection-20260910-1424-nodebt.log` | Before `join()`: TEE banner, position empty, `plan=no-debt`, result `SAFE`. |
| `liquidation-protection-20260910-1426-defend-reverted.log` | Right after `join()`: HF 111 ≤ private trigger, the enclave signed and broadcast `repay(1000.00 vUSD)` — tx [`0xf3e806bce55bc2ed87bd7bc3d9b7b3bbd604a4b1b4dc6f7514ace408dc7effe8`](https://sepolia.etherscan.io/tx/0xf3e806bce55bc2ed87bd7bc3d9b7b3bbd604a4b1b4dc6f7514ace408dc7effe8) **reverted with `Scenario has not started`**: the challenge contract's `onlyActive` gate only opens while Chainlink runs a scoring scenario. |
| `liquidation-protection-20260910-1433-inactive.log` | After adding an in-batch `eth_call` probe of `repay(1)`: the workflow detects the closed gate and returns `INACTIVE` without spending gas (intervention discipline). During a live scenario the same probe succeeds and the defend path runs unchanged. |

Thresholds, caps and the cooldown never appear in any log; the leak check in `README.md` was run before these files were added.
