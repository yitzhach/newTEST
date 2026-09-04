#!/usr/bin/env bash
# Runs the three smoke harnesses against tracker/ served over real HTTP at the
# live path shape (/newTEST/tracker/). Needs node + playwright + chromium.
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
[ -d package/dist ] || { npm pack leaflet@1.9.4 >/dev/null && tar xzf leaflet-1.9.4.tgz; }
[ -f tile.png ] || node make-tile.cjs tile.png
for f in 0*.cjs; do echo; echo "######## $f ########"; node "$f"; done
