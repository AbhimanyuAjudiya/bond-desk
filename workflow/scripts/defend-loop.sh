#!/usr/bin/env bash
# Scoring-window fallback for the Chainlink liquidation challenge. While `cre workflow deploy` is not available
# to us, re-run the liquidation-protection simulation every INTERVAL seconds until stopped. Each tick is one real
# cron execution of the handler: it reads the position from Sepolia and, when the challenge gate is open and the
# private policy says so, signs and broadcasts repay/deposit itself (the simulator's HTTP path sends for real).
# Caveat, spelled out in workflow/README.md "Scoring window fallback": the simulator is not an enclave, and the
# secrets come from workflow/.env instead of the Vault DON.
#
#   scripts/defend-loop.sh          # loop until Ctrl-C; full simulator output in workflow/.defend-logs/ (gitignored)
#   scripts/defend-loop.sh --once   # one tick, then exit (smoke test)
#   DEFEND_INTERVAL=30              # seconds between tick starts (default 30 = the workflow's cron period)
#   CRE_API_KEY=...                 # optional; the CLI uses it instead of the cached `cre login` session
set -u

# macOS: keep the machine awake for as long as the loop runs (-i = no idle sleep). Re-exec once, before cd.
if [ "${1:-}" != "--once" ] && [ -z "${DEFEND_CAFFEINATED:-}" ] && command -v caffeinate >/dev/null 2>&1; then
  DEFEND_CAFFEINATED=1 exec caffeinate -i "$0" "$@"
fi

cd "$(dirname "$0")/.." || exit 1 # workflow/
INTERVAL="${DEFEND_INTERVAL:-30}"
mkdir -p .defend-logs
LOG=".defend-logs/defend-$(date -u +%Y%m%dT%H%M%SZ).log"
echo "defend-loop start $(date -u +%FT%TZ) interval=${INTERVAL}s auth=$([ -n "${CRE_API_KEY:-}" ] && echo CRE_API_KEY || echo cached-login) log=$LOG" | tee -a "$LOG"

tick=0
while :; do
  tick=$((tick + 1))
  t0=$(date +%s)
  echo "===== tick $tick $(date -u +%FT%TZ) =====" | tee -a "$LOG"
  # A failed tick (auth 500, RPC timeout, compile hiccup) is logged and retried next tick; nothing aborts the loop.
  cre workflow simulate liquidation-protection --target staging-settings --non-interactive --trigger-index 0 2>&1 |
    tee -a "$LOG" | grep -E 'USER LOG|"status"|"repay"|"deposit"|0x[0-9a-f]{64}|rejected|✗|rror' || true
  if [ "${1:-}" = "--once" ]; then echo "one tick done, log: $LOG"; exit 0; fi
  elapsed=$(( $(date +%s) - t0 ))
  [ "$elapsed" -lt "$INTERVAL" ] && sleep $(( INTERVAL - elapsed ))
done
