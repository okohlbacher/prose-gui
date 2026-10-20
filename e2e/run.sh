#!/bin/bash
# End-to-end tests: build the debug binary, then run WebdriverIO through tauri-driver and
# WebKitWebDriver under xvfb-run, all inside native/scripts/in-env.sh.
#
#   e2e/run.sh [spec...]          (no spec: every e2e/*.spec.ts)
#
# Either `e2e/run.sh e2e/smoke.spec.ts` or `native/scripts/in-env.sh e2e/run.sh e2e/smoke.spec.ts`
# works: the script enters the environment itself when it is not in it.
# E2E_SKIP_BUILD=1 skips the build (the binary is up to date).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [ -z "${PROSE_IN_ENV:-}" ]; then
  export PROSE_IN_ENV=1
  exec "$ROOT/native/scripts/in-env.sh" "$ROOT/e2e/run.sh" "$@"
fi

cd "$ROOT"
if [ -z "${E2E_SKIP_BUILD:-}" ]; then
  npm run tauri:build:debug
fi

args=()
for s in "$@"; do args+=(--spec "$(realpath "$s")"); done
exec xvfb-run -a -s "-screen 0 1280x800x24" npx wdio run e2e/wdio.conf.ts "${args[@]}"
