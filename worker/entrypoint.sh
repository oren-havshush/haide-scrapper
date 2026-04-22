#!/bin/sh
set -e

echo "[worker] applying prisma migrations"
node_modules/.bin/prisma migrate deploy

echo "[worker] starting worker"
exec node_modules/.bin/tsx worker/index.ts
