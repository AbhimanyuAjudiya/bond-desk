#!/usr/bin/env bash
# Deploy PingWithoutHarness, fund it, schedule a ping, verify the source and poll the mirror node -- by hand.
# Everything here is what harness/script/DeployTemplate.s.sol + harness/scripts/{doctor,verify,validate-schedule}.sh do.
# Usage: HEDERA_PRIVATE_KEY=0x... harness/examples/without/deploy-verify-check.sh
set -euo pipefail

RPC="${HEDERA_RPC_URL:-https://testnet.hashio.io/api}"
MIRROR="https://testnet.mirrornode.hedera.com/api/v1"
KEY="${HEDERA_PRIVATE_KEY:?set HEDERA_PRIVATE_KEY}"
TARGET="harness/examples/WithoutHarness.sol:PingWithoutHarness"
cd "$(cd "$(dirname "$0")/../../.." && pwd)"
export FOUNDRY_PROFILE=harness # examples/ is outside the default profile; verify-contract needs it to build the source input

# right network?
[[ "$(cast chain-id --rpc-url "$RPC")" == "296" ]] || { echo "RPC is not Hedera testnet (296)" >&2; exit 1; }

# enough HBAR? (the relay reports balances as 18-decimal wei)
ME="$(cast wallet address --private-key "$KEY")"
BAL="$(cast balance "$ME" --rpc-url "$RPC" --ether | cut -d. -f1)"
(( BAL >= 20 )) || { echo "need >= 20 HBAR, $ME has $BAL" >&2; exit 1; }

# deploy
ADDR="$(forge create "$TARGET" --rpc-url "$RPC" --private-key "$KEY" --broadcast --json | jq -r .deployedTo)"
echo "deployed $ADDR"

# fund: the contract pays for its own scheduled execution
cast send "$ADDR" --value 5ether --rpc-url "$RPC" --private-key "$KEY" >/dev/null

# schedule ~2 minutes out and pull the schedule address out of the Scheduled(address,uint256) event
WHEN=$(( $(date +%s) + 120 ))
RECEIPT="$(cast send "$ADDR" 'schedulePing(uint256)' "$WHEN" --rpc-url "$RPC" --private-key "$KEY" --json)"
TOPIC="$(cast keccak 'Scheduled(address,uint256)')"
DATA="$(jq -r --arg t "$TOPIC" '.logs[] | select(.topics[0] == $t) | .data' <<<"$RECEIPT")"
SCHED="$(cast abi-decode 'f()(address,uint256)' "$DATA" | head -1)"
echo "schedule $SCHED fires at $WHEN"

# verify: sourcify, then hashscan's verifier
forge verify-contract "$ADDR" "$TARGET" --chain-id 296 --verifier sourcify --verifier-url https://sourcify.dev/server \
  || forge verify-contract "$ADDR" "$TARGET" --chain-id 296 --verifier sourcify --verifier-url https://server-verify.hashscan.io
echo "https://hashscan.io/testnet/contract/$ADDR"

# validate: long-zero EVM address -> 0.0.N, poll until executed_timestamp is set
NUM=$((16#${SCHED:26}))
for _ in $(seq 1 30); do
  TS="$(curl -s "$MIRROR/schedules/0.0.$NUM" | jq -r .executed_timestamp)"
  if [[ -n "$TS" && "$TS" != "null" ]]; then
    echo "executed at $TS  https://hashscan.io/testnet/schedule/0.0.$NUM"
    exit 0
  fi
  sleep 10
done
echo "schedule 0.0.$NUM did not execute within 5 minutes" >&2
exit 1
