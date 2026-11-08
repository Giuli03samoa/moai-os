#!/bin/bash
# Started by launchd (it.moaiathletics.os.db). Exits 0 on SIGTERM, so launchd restarts it only after a crash.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="__NODE_DIR__:/usr/bin:/bin:/usr/sbin:/sbin"
exec node_modules/.bin/tsx scripts/local-postgres.ts
