#!/bin/sh
set -e

echo "[worker] applying prisma migrations"
npx --no-install prisma migrate deploy

echo "[worker] starting worker"
exec npx --no-install tsx worker/index.ts
