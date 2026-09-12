#!/usr/bin/env sh
# Regenerate the ABI fragments consumed off-chain from the compiled contracts.
# Run after `forge build` from the repo root; commit the result.
# api/src/abi is also what web/ imports at build time (web/src/config/errors-abi.ts, web/src/config/abi.test.ts).
set -e
cd "$(dirname "$0")/.."
for c in BondRegistry BondMarket RiskGate BondLifecycle CollateralVault NavOracle MockUSDC IATSBond IATSAdmin; do
  forge inspect "$c" abi --json > "api/src/abi/$c.json"
done
cp api/src/abi/RiskGate.json relayer/src/abi/RiskGate.json
cp api/src/abi/RiskGate.json workflow/shared/abi/RiskGate.json
echo "synced ABIs into api/ (also used by web/), relayer/, workflow/"
