#!/bin/bash
# Started by launchd (it.moaiathletics.os.backup) once a day.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="__NODE_DIR__:/usr/bin:/bin:/usr/sbin:/sbin"
exec node_modules/.bin/tsx scripts/backup.ts
