#!/usr/bin/env bash
# Manages the self-contained PostgreSQL cluster used for local development.
#
#   npm run db:local            # create (first run) and start the cluster
#   npm run db:local stop       # stop the cluster
#   npm run db:local restart    # restart the cluster
#   npm run db:local status     # show whether the cluster is running
#
# The cluster lives in ./.pgdata and listens on port 5433, so it will not
# collide with a system PostgreSQL on 5432. It is owned by the current user and
# uses trust authentication on loopback, so starting it never asks for a
# password and never needs sudo. Data persists between runs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="${PGDATA:-$ROOT/.pgdata}"
PGLOG="${PGLOG:-$ROOT/.pglog}"
PORT="${PGPORT:-5433}"
DB_NAME="${PGDATABASE:-pos}"
DB_USER="${PGUSER:-pos}"
DB_PASS="${PGPASSWORD:-pos_dev_password}"
ACTION="${1:-start}"

# Pick a PostgreSQL binary that can read this cluster. Prefer the version that
# created the data directory, then whatever pg_ctl is on PATH, then the newest
# installed major version.
find_pg_bin() {
  if [ -s "$PGDATA/PG_VERSION" ]; then
    local ver
    ver="$(cat "$PGDATA/PG_VERSION")"
    if [ -x "/usr/lib/postgresql/$ver/bin/pg_ctl" ]; then
      echo "/usr/lib/postgresql/$ver/bin"
      return 0
    fi
  fi
  if command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return 0
  fi
  if ls -d /usr/lib/postgresql/*/bin >/dev/null 2>&1; then
    ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1
    return 0
  fi
  echo "PostgreSQL binaries not found. Install PostgreSQL 15+ first." >&2
  return 1
}

PG_BIN="$(find_pg_bin)"
export PATH="$PG_BIN:$PATH"

if [ "$(id -u)" = "0" ]; then
  echo "initdb/postgres cannot run as root. Run this script as a normal user." >&2
  exit 1
fi

mkdir -p "$PGLOG"

is_running() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1
}

port_busy() {
  pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1
}

print_ready() {
  echo
  echo "[db:local] ready"
  echo "  DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:$PORT/$DB_NAME"
  echo
}

do_status() {
  if is_running; then
    pg_ctl -D "$PGDATA" status
    echo
    print_ready
  else
    echo "[db:local] cluster is not running (data directory: $PGDATA)"
    exit 1
  fi
}

do_stop() {
  if is_running; then
    echo "[db:local] stopping cluster"
    pg_ctl -D "$PGDATA" -m fast stop >/dev/null
    echo "[db:local] stopped"
  else
    echo "[db:local] cluster is not running"
  fi
}

do_start() {
  local created=0

  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "[db:local] creating cluster in $PGDATA"
    initdb -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
    created=1
  fi

  if is_running; then
    echo "[db:local] cluster already running on port $PORT"
  elif port_busy; then
    echo "[db:local] port $PORT is already in use by another PostgreSQL server." >&2
    echo "[db:local] stop that server, or run with PGPORT=<other port> (and update DATABASE_URL)." >&2
    exit 1
  else
    echo "[db:local] starting cluster on port $PORT"
    pg_ctl -D "$PGDATA" -l "$PGLOG/postgres.log" \
      -o "-p $PORT -k $PGDATA -c listen_addresses=127.0.0.1" start >/dev/null
    for _ in $(seq 1 30); do
      if port_busy; then break; fi
      sleep 0.5
    done
  fi

  if ! port_busy; then
    echo "[db:local] PostgreSQL did not become ready — see $PGLOG/postgres.log" >&2
    exit 1
  fi

  if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1; then
    echo "[db:local] creating role $DB_USER"
    psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c \
      "CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '$DB_PASS'" >/dev/null
    created=1
  fi

  if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
    echo "[db:local] creating database $DB_NAME"
    createdb -h 127.0.0.1 -p "$PORT" -U postgres -O "$DB_USER" "$DB_NAME"
    created=1
  fi

  print_ready

  if [ "$created" = "1" ]; then
    echo "Next:"
    echo "  npm run db:reset && npm run db:demo   # create schema + demo data"
    echo "  npm run dev"
  else
    echo "Next: npm run dev"
  fi
}

case "$ACTION" in
  start) do_start ;;
  stop) do_stop ;;
  restart)
    do_stop
    do_start
    ;;
  status) do_status ;;
  *)
    echo "Usage: $0 [start|stop|restart|status]" >&2
    exit 1
    ;;
esac
