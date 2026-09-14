#!/usr/bin/env bash
set -euo pipefail

# Usage: ./deploy.sh <ec2-host> [ssh-key]
# Example: ./deploy.sh ubuntu@3.14.15.92
# Example: ./deploy.sh ubuntu@3.14.15.92 ~/.ssh/my-key.pem

HOST="${1:?Usage: ./deploy.sh <user@host> [ssh-key]}"
SSH_KEY="${2:-}"

SSH_OPTS="-o ConnectTimeout=10"
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

REMOTE_DIR="/opt/haide-scrapper"
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DEPLOY_TAG="deploy-$(date +%Y%m%d-%H%M%S)-${GIT_SHA}"

echo "==> Deploying $DEPLOY_TAG to $HOST ..."

# First-time setup: install Docker if not present
ssh $SSH_OPTS "$HOST" bash -s <<'SETUP'
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "Docker installed. You may need to log out and back in, then re-run this script."
  exit 1
fi
SETUP

# Sync project files (excluding unnecessary dirs)
#
# Two transports, because Git Bash on Windows ships no rsync and a deploy that
# dies at the sync step is easy to miss: `set -o pipefail` does not apply to the
# caller's pipeline, so `./deploy.sh host | tail` reported exit 0 while nothing
# had been transferred at all.
#
# .env and .env.local are excluded from BOTH paths. The server's own .env holds
# POSTGRES_PASSWORD, which the migration step below sources — overwriting it
# with a local file would break the deploy and the database credentials with it.
SYNC_EXCLUDES=(
  '.git'
  'node_modules'
  '.next'
  '.pnpm-store'
  'dist'
  'extension/node_modules'
  'extension/.output'
  'extension/.wxt'
  '.env'
  '.env.local'
  '.claude/worktrees'
)

echo "==> Syncing files..."
if command -v rsync >/dev/null 2>&1; then
  RSYNC_ARGS=(-avz --delete --filter='P .env' --filter='P .env.local')
  for pattern in "${SYNC_EXCLUDES[@]}"; do
    RSYNC_ARGS+=(--exclude="$pattern")
  done
  rsync "${RSYNC_ARGS[@]}" -e "ssh $SSH_OPTS" ./ "$HOST:$REMOTE_DIR/"
else
  # No rsync locally: stream a tar over the ssh connection instead.
  #
  # The one behavioural difference is that this does NOT delete files removed
  # since the last deploy — tar can only add and overwrite. Harmless for the
  # images, which are built from an explicit Dockerfile, but it does mean a
  # deleted source file lingers on the box until the next rsync-capable deploy.
  echo "    (rsync not found locally — streaming a tar instead; no --delete)"
  TAR_ARGS=()
  for pattern in "${SYNC_EXCLUDES[@]}"; do
    TAR_ARGS+=(--exclude="./$pattern")
  done
  tar czf - "${TAR_ARGS[@]}" . \
    | ssh $SSH_OPTS "$HOST" "mkdir -p '$REMOTE_DIR' && tar xzf - -C '$REMOTE_DIR'"
fi

# Build, migrate, and restart with rollback support
ssh $SSH_OPTS "$HOST" bash -s "$DEPLOY_TAG" "$REMOTE_DIR" <<'REMOTE'
# The `set -euo pipefail` at the top of this file governs only the LOCAL half.
# This heredoc is a separate bash, and it used to set no options at all — so a
# failed `prisma migrate deploy` below did not stop it. It went on to start the
# new images against the old schema, and because remote bash returns the status
# of its LAST command, the local `set -e` saw success and the deploy reported OK.
set -euo pipefail

DEPLOY_TAG="$1"
REMOTE_DIR="$2"
cd "$REMOTE_DIR"

# Never restart the worker out from under a running sweep.
#
# Probing the container, not the systemd unit: while a Type=oneshot unit's
# ExecStart runs, the unit sits in `activating`, not `active`, so
# `systemctl is-active` exits non-zero for the whole sweep and the guard would
# read "nothing running" every single time. The container probe is also the only
# one that sees a sweep started by hand with --now, outside systemd.
#
# Before `docker compose build`, so a refused deploy costs nothing and never
# half-builds.
SWEEP_CONTAINERS=$(docker ps -q -f name=haide-sweep- || true)
if [ -n "$SWEEP_CONTAINERS" ]; then
  echo "==> A sweep is running (started $(docker ps --format '{{.RunningFor}}' -f name=haide-sweep- | head -1) ago). Refusing to deploy."
  exit 1
fi

COMPOSE_PROJECT=$(basename "$REMOTE_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')

# Tag current images as "previous" BEFORE building (for rollback)
for svc in web worker; do
  IMAGE="${COMPOSE_PROJECT}-${svc}"
  if docker image inspect "$IMAGE" &>/dev/null; then
    docker tag "$IMAGE" "$IMAGE:previous"
  fi
done

echo "==> Building images tagged $DEPLOY_TAG..."
docker compose build

# Tag new images with deploy tag
for svc in web worker; do
  IMAGE="${COMPOSE_PROJECT}-${svc}"
  if docker image inspect "$IMAGE" &>/dev/null; then
    docker tag "$IMAGE" "$IMAGE:$DEPLOY_TAG"
  fi
done

echo "==> Running database migrations..."
set -a
source .env 2>/dev/null || true
set +a

# Under `set -u` a missing password would abort with "unbound variable" fifteen
# lines later. Fail here instead, saying what is wrong. Aborting is right: the
# alternative is building `postgresql://postgres:@db:5432/scrapnew` and letting
# the migration decide what an empty password means.
: "${POSTGRES_PASSWORD:?is not set in $REMOTE_DIR/.env — refusing to migrate}"

# `|| true` INSIDE the substitution, not after the assignment. `grep` exits 1
# when it matches nothing, and under `pipefail` + `set -e` that aborts the
# deploy — making the `if [ -z ... ]` fallback directly below unreachable, which
# is the opposite of what it is there for.
NETWORK=$(docker network ls --filter "name=${COMPOSE_PROJECT}" --format '{{.Name}}' | grep default | head -1 || true)
if [ -z "$NETWORK" ]; then
  NETWORK="${COMPOSE_PROJECT}-default"
fi

docker compose up -d db
sleep 3

# Back up BEFORE migrating. The backup at the end of this script only runs after
# a successful deploy, so a migration that corrupts or half-applies would have
# run against a database whose newest backup predates it — possibly by days.
#
# Deliberately NOT `|| true`: if we cannot take a backup we must not migrate.
# The post-deploy backup stays non-fatal; this one is the safety net.
echo "==> Backing up the database before migrating..."
docker compose --profile backup run --rm db-backup

docker run --rm --network "$NETWORK" \
  -e DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/scrapnew" \
  "${COMPOSE_PROJECT}-worker" node_modules/.bin/prisma migrate deploy

echo "==> Starting services..."
docker compose up -d

# Health check - wait for web to be healthy
echo "==> Waiting for services to be healthy..."
TIMEOUT=60
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  STATUS=$(docker compose ps web --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || true)
  if echo "$STATUS" | grep -q "healthy"; then
    echo "==> Web service is healthy!"
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo "    Waiting... ($ELAPSED/$TIMEOUT s)"
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "WARNING: Web service did not become healthy within ${TIMEOUT}s"
  echo "==> Rolling back..."
  for svc in web worker; do
    IMAGE="${COMPOSE_PROJECT}-${svc}"
    if docker image inspect "$IMAGE:previous" &>/dev/null; then
      docker tag "$IMAGE:previous" "$IMAGE:latest"
    fi
  done
  docker compose up -d
  echo "==> Rollback complete. Check logs: docker compose logs"
  exit 1
fi

# Run backup after successful deploy
echo "==> Running database backup..."
docker compose --profile backup run --rm db-backup || echo "WARNING: Backup failed (non-fatal)"

echo "==> Deploy $DEPLOY_TAG complete! Services running:"
docker compose ps
REMOTE

echo "==> Deployment complete: $DEPLOY_TAG"
