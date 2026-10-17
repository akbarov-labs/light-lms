#!/bin/sh
# Restore the database from a dump made by backup.sh. Run on the server from the project folder:
#   ./deploy/restore.sh backups/lms-20261012-023000.dump
#   ./deploy/restore.sh /home/me/lms-copied-from-laptop.dump      (any path works)
# It first takes a fresh safety backup, stops web + worker, restores in one transaction, starts them again.
set -eu

FILE="${1:?usage: deploy/restore.sh path/to/lms-YYYYMMDD-HHMMSS.dump}"
[ -f "$FILE" ] || { echo "no such file: $FILE"; exit 1; }
NAME=$(basename "$FILE")
# ENV_FILE=… only when the settings are not in ./.env (e.g. a local test of the production setup)
DC="docker compose -f docker-compose.prod.yml${ENV_FILE:+ --env-file $ENV_FILE}"
# the dump is copied into the backup container, so it does not have to be inside BACKUP_DIR
TMP=/tmp/restore-$$.dump

echo "== safety backup of the current database"
$DC exec -T backup sh /usr/local/bin/backup.sh

echo "== copying $NAME into the backup container"
$DC cp "$FILE" "backup:$TMP"
trap '$DC exec -T backup rm -f "$TMP" || true' EXIT
$DC exec -T backup pg_restore --list "$TMP" > /dev/null || { echo "not a readable pg_dump archive: $FILE"; exit 1; }

echo "== stopping web and worker"
$DC stop web worker

echo "== restoring $NAME"
$DC exec -T backup pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error -d lms "$TMP"

echo "== applying migrations (an older dump may predate the current schema)"
$DC run --rm migrate

echo "== starting web and worker"
$DC up -d web worker
echo "done"
