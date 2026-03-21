#!/usr/bin/env bash
set -euo pipefail

# Database backup script - runs inside the db-backup service
# Keeps the last 7 daily backups

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/scrapnew_$TIMESTAMP.sql.gz"

echo "[backup] Starting database backup..."

pg_dump -h db -U postgres scrapnew | gzip > "$BACKUP_FILE"

echo "[backup] Created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Prune backups older than 7 days
find "$BACKUP_DIR" -name "scrapnew_*.sql.gz" -mtime +7 -delete

echo "[backup] Pruned old backups. Current backups:"
ls -lh "$BACKUP_DIR"/scrapnew_*.sql.gz 2>/dev/null || echo "(none)"
