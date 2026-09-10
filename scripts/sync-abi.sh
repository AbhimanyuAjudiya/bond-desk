#!/usr/bin/env sh
# Regenerate the ABI fragments consumed off-chain from the compiled contracts.
# Run after `forge build` from the repo root; commit the result.
set -e
cd "$(dirname "$0")/.."
for c in BondRegistry BondMarket RiskGate; do
  forge inspect "$c" abi --json > "api/src/abi/$c.json"
done
forge inspect IATSAdmin abi --json > api/src/abi/IKyc.json
cp api/src/abi/RiskGate.json relayer/src/abi/RiskGate.json
cp api/src/abi/RiskGate.json workflow/shared/abi/RiskGate.json
echo "synced ABIs into api/, relayer/, workflow/"
