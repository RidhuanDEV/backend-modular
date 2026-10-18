#!/bin/bash
set -Eeuo pipefail
# The official initializer interpolates MYSQL_PASSWORD into SQL. Use a safe
# temporary value, then set the actual password before the public server starts.
if [[ -n "${MYSQL_USER:-}" && -n "${MYSQL_PASSWORD:-}" ]]; then
  export RIDHUAN_MYSQL_APP_PASSWORD="$MYSQL_PASSWORD"
  export MYSQL_PASSWORD='bootstrap-only-replaced-before-server-listens'
fi
exec /usr/local/bin/docker-entrypoint.sh "$@"
