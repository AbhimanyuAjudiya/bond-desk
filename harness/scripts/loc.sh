#!/usr/bin/env bash
# Non-blank, non-comment line counts behind the before/after table in harness/README.md.
# Usage: harness/scripts/loc.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

loc() { grep -cvE '^[[:space:]]*($|//|/\*|\*|#)' "$1" || true; }

c_before=$(loc examples/WithoutHarness.sol)
c_after=$(loc examples/WithHarness.sol)
d_before=$(loc examples/without/deploy-verify-check.sh)
d_after=$(loc script/DeployTemplate.s.sol)
lib=$(( $(loc src/HederaHarness.sol) + $(loc src/HederaTest.sol) + $(loc src/interfaces/IHederaScheduleService.sol) + $(loc src/interfaces/IHederaTokenService.sol) ))

printf '| Per project | Without harness | With harness |\n|---|---:|---:|\n'
printf '| Contract: interface, probe, response codes (`examples/WithoutHarness.sol` vs `examples/WithHarness.sol`) | %s | %s |\n' "$c_before" "$c_after"
printf '| Deploy, fund, schedule, verify, validate (`examples/without/deploy-verify-check.sh` vs `script/DeployTemplate.s.sol`; verify/validate become one-line calls to `scripts/`) | %s | %s |\n' "$d_before" "$d_after"
printf '| **Total** | **%s** | **%s** |\n' "$((c_before + d_before))" "$((c_after + d_after))"
printf '\nShared once (`src/HederaHarness.sol`, `src/HederaTest.sol`, interfaces): %s lines.\n' "$lib"
