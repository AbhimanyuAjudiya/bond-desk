#!/usr/bin/env bash
# Tier 1: is this machine ready to deploy to Hedera testnet? Prints a table; exit code = number of failed checks.
# Usage: harness/scripts/doctor.sh [--help]   (reads .env from the repo root when present)
set -uo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,3p' "$0" | sed 's/^# //'
  exit 0
fi

cd "$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -f .env ]]; then set -a; . ./.env; set +a; fi

RPC="${HEDERA_RPC_URL:-https://testnet.hashio.io/api}"
MIRROR="${MIRROR_URL:-https://testnet.mirrornode.hedera.com/api/v1}"
MIN_HBAR="${MIN_HBAR:-20}"

fails=0
rows=()
check() { # name status detail
  [[ "$2" == "FAIL" ]] && fails=$((fails + 1))
  rows+=("| $1 | $2 | $3 |")
}
rpc() { # method params-json -> "result" value
  curl -sS -m 10 -X POST -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" "$RPC" 2>/dev/null \
    | grep -oE '"result":"[^"]*"' | cut -d'"' -f4
}

# forge >= 1.0
if command -v forge >/dev/null 2>&1; then
  ver="$(forge --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [[ -n "$ver" && "${ver%%.*}" -ge 1 ]]; then
    check "forge >= 1.0" PASS "$ver ($(command -v forge))"
  else
    check "forge >= 1.0" FAIL "${ver:-unknown} at $(command -v forge); run foundryup"
  fi
else
  check "forge >= 1.0" FAIL "not on PATH; install with foundryup"
fi

# PATH order: an old cargo-installed forge shadows the foundryup one
first="$(command -v forge 2>/dev/null || true)"
if [[ "$first" == "$HOME/.cargo/bin/forge" && -x "$HOME/.foundry/bin/forge" ]]; then
  check "PATH order" FAIL "~/.cargo/bin/forge shadows ~/.foundry/bin/forge; put ~/.foundry/bin first"
else
  check "PATH order" PASS "${first:-n/a}"
fi

# solc 0.8.28 (forge downloads it on first build; report whether it is cached)
solc_dir=""
for d in "$HOME/.svm/0.8.28" "$HOME/Library/Application Support/svm/0.8.28"; do
  [[ -d "$d" ]] && solc_dir="$d"
done
if [[ -n "$solc_dir" ]]; then
  check "solc 0.8.28" PASS "$solc_dir"
else
  check "solc 0.8.28" WARN "not cached yet; forge fetches it on first build"
fi

# RPC
cid="$(rpc eth_chainId '[]')"
if [[ "$cid" == "0x128" ]]; then
  check "RPC chainId 0x128 (296)" PASS "$RPC"
else
  check "RPC chainId 0x128 (296)" FAIL "$RPC returned '${cid:-nothing}'"
fi

# key + balance
if [[ -z "${HEDERA_PRIVATE_KEY:-}" || "$HEDERA_PRIVATE_KEY" == "0x" ]]; then
  check "HEDERA_PRIVATE_KEY" FAIL "unset in .env (see harness/FAUCET.md)"
  check "balance >= $MIN_HBAR HBAR" FAIL "skipped"
else
  addr="$(cast wallet address --private-key "$HEDERA_PRIVATE_KEY" 2>/dev/null || true)"
  if [[ -z "$addr" ]]; then
    check "HEDERA_PRIVATE_KEY" FAIL "cast could not derive an address from it"
    check "balance >= $MIN_HBAR HBAR" FAIL "skipped"
  else
    check "HEDERA_PRIVATE_KEY" PASS "$addr"
    hex="$(rpc eth_getBalance "[\"$addr\",\"latest\"]")"
    if [[ -n "$hex" ]]; then
      hbar="$(cast to-unit "$hex" ether 2>/dev/null | cut -d. -f1)"
      if [[ -n "$hbar" && "$hbar" -ge "$MIN_HBAR" ]]; then
        check "balance >= $MIN_HBAR HBAR" PASS "$hbar HBAR"
      else
        check "balance >= $MIN_HBAR HBAR" FAIL "${hbar:-?} HBAR; top up via harness/FAUCET.md"
      fi
    else
      check "balance >= $MIN_HBAR HBAR" FAIL "eth_getBalance failed"
    fi
  fi
fi

# sourcify knows chain 296
if curl -sS -m 10 https://sourcify.dev/server/chains 2>/dev/null | grep -qE '"chainId": ?296[,}]'; then
  check "sourcify lists 296" PASS "https://sourcify.dev/server"
else
  check "sourcify lists 296" FAIL "verify.sh will fall back to https://server-verify.hashscan.io"
fi

# mirror node
code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$MIRROR/network/nodes?limit=1" 2>/dev/null)"
if [[ "$code" == "200" ]]; then
  check "mirror node" PASS "$MIRROR"
else
  check "mirror node" FAIL "$MIRROR -> HTTP ${code:-none}"
fi

printf '| Check | Status | Detail |\n|---|---|---|\n'
printf '%s\n' "${rows[@]}"
echo
echo "$fails failure(s)"
exit "$fails"
