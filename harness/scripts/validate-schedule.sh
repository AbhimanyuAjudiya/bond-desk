#!/usr/bin/env bash
# Tier 3.5: ask the mirror node whether a scheduled call executed. Exit 0 iff executed_timestamp != null.
# Usage: harness/scripts/validate-schedule.sh <schedule EVM address | 0.0.N> [--wait <seconds>]
set -uo pipefail

usage() { sed -n '2,3p' "$0" | sed 's/^# //'; }

if [[ $# -lt 1 || "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && exit 0
  exit 2
fi

ID="$1"
shift
WAIT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --wait) WAIT="${2:-0}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

MIRROR="${MIRROR_URL:-https://testnet.mirrornode.hedera.com/api/v1}"

# HSS returns long-zero EVM addresses: 24 zero nibbles followed by the entity number.
if [[ "$ID" =~ ^0\.0\.[0-9]+$ ]]; then
  num="${ID##*.}"
elif [[ "$ID" =~ ^(0x)?[0-9a-fA-F]{40}$ ]]; then
  hex="${ID#0x}"
  if [[ "${hex:0:24}" != "000000000000000000000000" ]]; then
    echo "$ID is not a long-zero address; schedule addresses always are" >&2
    exit 2
  fi
  num=$((16#${hex:24}))
else
  usage
  exit 2
fi

url="$MIRROR/schedules/0.0.$num"
link="https://hashscan.io/testnet/schedule/0.0.$num"
deadline=$(( $(date +%s) + WAIT ))

while :; do
  body="$(curl -sS -m 10 "$url" 2>/dev/null)"
  if [[ -z "$body" ]]; then
    state="mirror node unreachable"
  elif grep -q '"executed_timestamp":"' <<<"$body"; then
    ts="$(grep -oE '"executed_timestamp":"[^"]*"' <<<"$body" | cut -d'"' -f4)"
    echo "executed at $ts  $link"
    exit 0
  elif grep -q '"executed_timestamp":null' <<<"$body"; then
    state="pending"
  else
    state="not found"
  fi
  if (( $(date +%s) >= deadline )); then
    break
  fi
  echo "0.0.$num: $state; retrying in 10s"
  sleep 10
done

echo "0.0.$num: $state  $link" >&2
exit 1
