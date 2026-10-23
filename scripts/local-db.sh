#!/usr/bin/env bash
# Creates and starts a self-contained PostgreSQL cluster for local development.
#
#   npm run db:local
#
# The cluster lives in ./.pgdata and listens on port 5433, so it will not
# collide with a system PostgreSQL on 5432. Data persists between runs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="${PGDATA:-$ROOT/.pgdata}"
PGLOG="${PGLOG:-$ROOT/.pglog}"
PORT="${PGPORT:-5433}"
DB_NAME="${PGDATABASE:-pos}"
DB_USER="${PGUSER:-pos}"
DB_PASS="${PGPASSWORD:-pos_dev_password}"

# Locate PostgreSQL binaries: prefer PATH, then the usual Debian/Ubuntu dirs.
if command -v pg_ctl >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v pg_ctl)")"
elif ls -d /usr/lib/postgresql/*/bin >/dev/null 2>&1; then
  PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
else
  echo "PostgreSQL binaries not found. Install PostgreSQL 15+ first." >&2
  exit 1
fi
export PATH="$PG_BIN:$PATH"

if [ "$(id -u)" = "0" ]; then
  echo "initdb/postgres cannot run as root. Run this script as a normal user." >&2
  exit 1
fi

mkdir -p "$PGLOG"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[db:local] creating cluster in $PGDATA"
  initdb -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
fi

if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  echo "[db:local] cluster already running on port $PORT"
else
  echo "[db:local] starting cluster on port $PORT"
  pg_ctl -D "$PGDATA" -l "$PGLOG/postgres.log" -o "-p $PORT -k $PGDATA" start >/dev/null
  for _ in $(seq 1 30); do
    if pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
fi

if ! pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  echo "[db:local] PostgreSQL did not become ready — see $PGLOG/postgres.log" >&2
  exit 1
fi

if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1; then
  echo "[db:local] creating role $DB_USER"
  psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c \
    "CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '$DB_PASS'" >/dev/null
fi

if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  echo "[db:local] creating database $DB_NAME"
  createdb -h 127.0.0.1 -p "$PORT" -U postgres -O "$DB_USER" "$DB_NAME"
fi

echo
echo "[db:local] ready"
echo "  DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:$PORT/$DB_NAME"
echo
echo "Next:"
echo "  npm run db:reset && npm run db:demo"
echo "  npm run dev"
