#!/usr/bin/env bash
# Provisions the Ledger POS role and database on an existing PostgreSQL server.
#
#   ADMIN_URL=postgres://postgres:secret@db.example.com:5432/postgres \
#     bash scripts/setup-db.sh
#
# Optional overrides: DB_NAME, DB_USER, DB_PASS.
# After this finishes, put the printed DATABASE_URL in server/.env and run
# `npm run db:reset`.
set -euo pipefail

ADMIN_URL="${ADMIN_URL:-postgres://postgres@127.0.0.1:5432/postgres}"
DB_NAME="${DB_NAME:-pos}"
DB_USER="${DB_USER:-pos}"
DB_PASS="${DB_PASS:-pos_dev_password}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install the PostgreSQL client first." >&2
  exit 1
fi

echo "[db:setup] provisioning role and database on the admin connection"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
  -v db_user="$DB_USER" -v db_pass="$DB_PASS" -v db_name="$DB_NAME" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec
SQL

HOSTPART="${ADMIN_URL#*@}"
HOSTPORT="${HOSTPART%%/*}"
echo
echo "[db:setup] done"
echo "  DATABASE_URL=postgres://$DB_USER:$DB_PASS@$HOSTPORT/$DB_NAME"
echo
echo "Add that URL to server/.env, then run:"
echo "  npm run db:reset"
echo "  npm run db:demo   # optional demo trading history"
