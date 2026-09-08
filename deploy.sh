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
DEPLOY_TAG="$1"
REMOTE_DIR="$2"
cd "$REMOTE_DIR"

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
set -a && source .env 2>/dev/null || true && set +a

NETWORK=$(docker network ls --filter "name=${COMPOSE_PROJECT}" --format '{{.Name}}' | grep default | head -1)
if [ -z "$NETWORK" ]; then
  NETWORK="${COMPOSE_PROJECT}-default"
fi

docker compose up -d db
sleep 3

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
