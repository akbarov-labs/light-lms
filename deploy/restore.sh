#!/bin/sh
# Restore the database from a dump made by backup.sh. Run on the server from the project folder:
#   ./deploy/restore.sh backups/lms-20261012-023000.dump
# It first takes a fresh safety backup, stops web + worker, restores in one transaction, starts them again.
set -eu

FILE="${1:?usage: deploy/restore.sh backups/lms-YYYYMMDD-HHMMSS.dump}"
[ -f "$FILE" ] || { echo "no such file: $FILE"; exit 1; }
NAME=$(basename "$FILE")
# ENV_FILE=… only when the settings are not in ./.env (e.g. a local test of the production setup)
DC="docker compose -f docker-compose.prod.yml${ENV_FILE:+ --env-file $ENV_FILE}"

echo "== safety backup of the current database"
$DC exec -T backup sh /usr/local/bin/backup.sh

echo "== stopping web and worker"
$DC stop web worker

echo "== restoring $NAME"
# the backups folder is mounted at /backups inside the backup container
$DC exec -T backup pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error -d lms "/backups/$NAME"

echo "== applying migrations (an older dump may predate the current schema)"
$DC run --rm migrate

echo "== starting web and worker"
$DC up -d web worker
echo "done"
