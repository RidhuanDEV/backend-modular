#!/bin/bash
# Optional least-privilege runtime role, created on the first start of an empty data volume.
# POSTGRES_USER stays the schema owner (migrations); the application connects as APP_DB_USER,
# which can only read and write rows. Non-executable hooks are sourced by PostgreSQL, so the
# body runs in a subshell to isolate options and exit statements. For an existing volume, run:
#   docker compose exec postgres bash /docker-entrypoint-initdb.d/10-app-role.sh
(
set -Eeuo pipefail
if [[ -z "${APP_DB_USER:-}" ]]; then
  exit 0
fi
if [[ ! "$APP_DB_USER" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
  echo 'Invalid APP_DB_USER' >&2
  exit 1
fi
if [[ -z "${APP_DB_PASSWORD:-}" || "$APP_DB_USER" == "$POSTGRES_USER" ]]; then
  echo 'APP_DB_PASSWORD is required and APP_DB_USER must differ from POSTGRES_USER' >&2
  exit 1
fi
# psql variables quote identifiers (:"name") and literals (:'name'), so values never become SQL.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" \
  -v owner="$POSTGRES_USER" -v database="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec
ALTER ROLE :"app_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';
GRANT CONNECT ON DATABASE :"database" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
SQL
)
