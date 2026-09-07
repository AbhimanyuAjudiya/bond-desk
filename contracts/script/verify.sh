#!/usr/bin/env bash
# Verify every Bond Desk contract in deployments/testnet.json on Hedera testnet (Sourcify, HashScan fallback).
# Usage: contracts/script/verify.sh [deployments/testnet.json]   -- idempotent, re-run until everything is green.
set -uo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"
FILE="${1:-deployments/testnet.json}"
[[ -f "$FILE" ]] || { echo "missing $FILE (run Deploy.s.sol first)" >&2; exit 2; }

# key:path:Name -- constructor args come from .args.<key> (written by Deploy.s.sol)
ENTRIES=(
  registry:contracts/src/BondRegistry.sol:BondRegistry
  oracle:contracts/src/NavOracle.sol:NavOracle
  vault:contracts/src/CollateralVault.sol:CollateralVault
  market:contracts/src/BondMarket.sol:BondMarket
  lifecycle:contracts/src/BondLifecycle.sol:BondLifecycle
  riskGate:contracts/src/RiskGate.sol:RiskGate
  settlement:contracts/src/mocks/MockUSDC.sol:MockUSDC
)
failed=()
for entry in "${ENTRIES[@]}"; do
  key="${entry%%:*}"; target="${entry#*:}"
  addr="$(jq -r ".$key" "$FILE")"
  args="$(jq -r ".args.$key // empty" "$FILE")"
  # settlement is only ours (MockUSDC) when Deploy.s.sol wrote args.settlement
  if [[ "$key" == settlement ]] && ! jq -e '.args | has("settlement")' "$FILE" >/dev/null; then
    echo "== settlement $addr is external, skipping"; continue
  fi
  [[ "$args" == "0x" ]] && args=""
  harness/scripts/verify.sh "$addr" "$target" "$args" || failed+=("$key")
done

echo
echo "HashScan:"
for entry in "${ENTRIES[@]}"; do
  key="${entry%%:*}"; addr="$(jq -r ".$key" "$FILE")"
  printf '  %-10s https://hashscan.io/testnet/contract/%s\n' "$key" "$addr"
done
printf '  %-10s https://hashscan.io/testnet/contract/%s\n' token "$(jq -r .token "$FILE")"

if (( ${#failed[@]} )); then echo "failed: ${failed[*]}" >&2; exit 1; fi
echo "all verified"
