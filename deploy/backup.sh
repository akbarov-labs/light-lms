#!/bin/sh
# One backup: pg_dump (custom format, compressed) → /backups/lms-YYYYMMDD-HHMMSS.dump, then delete
# dumps older than BACKUP_KEEP_DAYS. Runs inside the `backup` container (PG* env vars are set there).
# Manual run:  docker compose -f docker-compose.prod.yml exec backup sh /usr/local/bin/backup.sh
set -eu

DIR=/backups
KEEP="${BACKUP_KEEP_DAYS:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$DIR/lms-$STAMP.dump"
TMP="$DIR/.lms-$STAMP.dump.partial"

trap 'rm -f "$TMP"' EXIT
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$TMP"
# make sure the archive is readable before it replaces anything
pg_restore --list "$TMP" > /dev/null
mv "$TMP" "$FILE"
chmod 600 "$FILE"

# rotation only after a good dump, so a broken night never deletes the last good copies
find "$DIR" -maxdepth 1 -name 'lms-*.dump' -type f -mtime +"$((KEEP - 1))" -print -delete | sed 's/^/[backup] removed /'
echo "[backup] $(date '+%F %T') ok $(basename "$FILE") $(du -h "$FILE" | cut -f1), kept $(ls "$DIR"/lms-*.dump | wc -l) file(s)"
