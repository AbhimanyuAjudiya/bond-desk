#!/usr/bin/env sh
# Pull the last VERDICT_JSON line out of a `cre workflow simulate` log (stdin) -> verdict JSON (stdout).
# Usage: scripts/extract-verdict.sh < ../docs/cre-evidence/bond-monitor-<ts>.log > inbox/verdict-<ts>.json
grep -o 'VERDICT_JSON {.*}' | tail -1 | sed 's/^VERDICT_JSON //'
