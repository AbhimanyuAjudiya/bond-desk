# Testnet HBAR

Hedera testnet is chain 296, RPC `https://testnet.hashio.io/api`.

1. **Key.** `cast wallet new` prints an ECDSA address + private key. The account is created on the ledger the first time it receives HBAR.
2. **Faucet.** https://portal.hedera.com/faucet — paste the EVM address. Anonymous: 100 HBAR / 24 h. With a portal account: 1000 HBAR / 24 h.
3. **`.env`.** Copy `.env.example` to `.env`, set `HEDERA_PRIVATE_KEY=0x...`. Confirm with `harness/scripts/doctor.sh` (wants >= 20 HBAR).
4. **Contracts that schedule pay.** HIP-1215 charges the *calling contract* for the future execution, so fund it before scheduling: `cast send <addr> --value 5ether --rpc-url hedera --private-key $HEDERA_PRIVATE_KEY`. The relay takes 18-decimal wei; inside the EVM the contract sees tinybar (`5 ether` -> `5e8`).

Budget: a deploy costs well under 1 HBAR; one 2M-gas scheduled call at ~1000 gwei is ~2 HBAR. Gas prices sit around 340–1160 gwei and the per-tx cap is 15M gas, so `--slow` and, if a type-2 tx is rejected, `--legacy` are the usual broadcast flags.
