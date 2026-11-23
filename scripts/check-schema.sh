#!/usr/bin/env bash
# Valida server/db/schema.sql em uma instância PostgreSQL temporária.
# Requer os binários do PostgreSQL (initdb, pg_ctl, psql) no PATH ou em /usr/lib/postgresql/*/bin.
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)
export PATH="$BIN:$PATH"
DIR=$(mktemp -d)
PORT=${PGPORT_TEST:-55432}
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id veu_pg >/dev/null 2>&1 || useradd -M veu_pg
  chown -R veu_pg "$DIR"
  RUNAS="runuser -u veu_pg --"
fi
$RUNAS initdb -D "$DIR/data" -A trust -U postgres >/dev/null
$RUNAS pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" start -w >/dev/null
trap '$RUNAS pg_ctl -D "$DIR/data" stop -m fast >/dev/null; rm -rf "$DIR"' EXIT
psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/../server/db/schema.sql"
psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/../server/db/schema.sql"  # idempotente
psql -h "$DIR" -p "$PORT" -U postgres -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
