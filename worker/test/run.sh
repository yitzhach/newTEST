#!/usr/bin/env bash
# ===========================================================================
# Run the API tests against a throwaway local Worker.
#
# The suite asserts on things that are stateful by nature — an invite burning
# on first use, the bootstrap code refusing to run twice, a rate limit biting —
# so it needs a database and a KV namespace that start empty every time.
# Reusing yesterday's local state makes half these tests lie.
# ===========================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
LOG="${LOG:-/tmp/show-ledger-worker-test.log}"

if [ ! -f .dev.vars ]; then
  cat > .dev.vars <<'VARS'
SESSION_SECRET=local-dev-only-not-a-real-secret-0123456789abcdef
IP_SALT=local-dev-salt
BOOTSTRAP_CODE=BOOT-STRA-PCOD-E123
VARS
  echo "wrote .dev.vars for local testing"
fi

cleanup() {
  if [ -n "${WORKER_PID:-}" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
    kill "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "resetting local state..."
rm -rf .wrangler/state/v3/d1 .wrangler/state/v3/kv
npx wrangler d1 migrations apply show-ledger-intel --local >/dev/null 2>&1
echo "  schema applied"

echo "starting worker on :$PORT ..."
npx wrangler dev --local --port "$PORT" --ip 127.0.0.1 >"$LOG" 2>&1 &
WORKER_PID=$!

for i in $(seq 1 40); do
  if curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "  ready"
    break
  fi
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "worker died on startup:"; tail -20 "$LOG"; exit 1
  fi
  sleep 1
done

BASE="http://127.0.0.1:$PORT" node test/api.test.js
STATUS=$?

if grep -q "ERROR" "$LOG" 2>/dev/null; then
  echo
  echo "note: the worker log recorded errors (some are expected — the suite"
  echo "deliberately sends bad input). Full log: $LOG"
fi

exit $STATUS
