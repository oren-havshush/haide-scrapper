#!/bin/sh
set -eu

# Database backup script - runs inside the db-backup service.
# Compose invokes us as `/bin/sh /backup.sh`, and on postgres:16-alpine
# /bin/sh is BusyBox ash (no `pipefail`), so this script stays POSIX-safe.
# Keeps the last 7 daily backups.

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/scrapnew_$TIMESTAMP.sql.gz"

echo "[backup] Starting database backup..."

# Dump to a temp file first instead of piping into gzip, so that a pg_dump
# failure is caught by `set -e` (a `pg_dump | gzip` pipeline would otherwise
# silently mask pg_dump errors without `set -o pipefail`, which ash lacks).
TMP_DUMP=$(mktemp)
trap 'rm -f "$TMP_DUMP"' EXIT

pg_dump -h db -U postgres scrapnew > "$TMP_DUMP"
gzip -c "$TMP_DUMP" > "$BACKUP_FILE"

echo "[backup] Created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

find "$BACKUP_DIR" -name "scrapnew_*.sql.gz" -mtime +7 -delete

echo "[backup] Pruned old backups. Current backups:"
ls -lh "$BACKUP_DIR"/scrapnew_*.sql.gz 2>/dev/null || echo "(none)"
