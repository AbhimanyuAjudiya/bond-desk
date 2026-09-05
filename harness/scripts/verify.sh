#!/usr/bin/env bash
# Verify a contract on Hedera testnet (chain 296): Sourcify first, HashScan's verifier as fallback.
# Usage: harness/scripts/verify.sh <address> <path/To/File.sol:ContractName> [abi-encoded constructor args]
set -uo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 2 ]]; then
  sed -n '2,3p' "$0" | sed 's/^# //'
  [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && exit 0
  exit 2
fi

ADDR="$1"
TARGET="$2"
ARGS="${3:-}"
# harness/ sources live outside the default profile's src/test/script, so the standard-json input needs [profile.harness].
case "$TARGET" in harness/*) export FOUNDRY_PROFILE="${FOUNDRY_PROFILE:-harness}" ;; esac
cd "$(cd "$(dirname "$0")/../.." && pwd)"

extra=()
[[ -n "$ARGS" ]] && extra=(--constructor-args "$ARGS")

for url in https://sourcify.dev/server https://server-verify.hashscan.io; do
  echo "== $TARGET @ $ADDR via $url"
  if forge verify-contract "$ADDR" "$TARGET" --chain-id 296 --verifier sourcify --verifier-url "$url" ${extra[@]+"${extra[@]}"}; then
    echo "verified: https://hashscan.io/testnet/contract/$ADDR"
    exit 0
  fi
done

echo "verification failed on both verifiers" >&2
exit 1
