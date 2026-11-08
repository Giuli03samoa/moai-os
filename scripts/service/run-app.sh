#!/bin/bash
# Started by launchd (it.moaiathletics.os.app). Waits for the database, applies pending migrations,
# rebuilds when the code changed since the last build, then serves MOAI OS on http://localhost:3000.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="__NODE_DIR__:/usr/bin:/bin:/usr/sbin:/sbin"
for i in $(seq 1 120); do nc -z 127.0.0.1 54329 2>/dev/null && break; sleep 1; done
npx prisma migrate deploy
HEAD="$(git rev-parse HEAD 2>/dev/null || echo nogit)$(git status --porcelain 2>/dev/null | shasum | cut -c1-12)"
if [ ! -f .next/BUILD_ID ] || [ "$(cat .local/built-head 2>/dev/null)" != "$HEAD" ]; then
  echo "$(date '+%F %T') build di produzione…"
  npm run build
  mkdir -p .local && echo "$HEAD" > .local/built-head
fi
exec node_modules/.bin/next start -p 3000
