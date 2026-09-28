#!/bin/sh
set -eu
project=modular-go-migration-gate
compose() {
  docker compose --env-file .env.example -p "$project" -f compose.yaml -f scripts/compose.verify.yaml -f scripts/compose.migration-failure.yaml "$@"
}
trap 'compose down --volumes --remove-orphans' EXIT
if compose up --build -d app; then
  echo "Expected migration failure to block app startup" >&2
  exit 1
fi
app_id=$(compose ps -a -q app)
test -n "$app_id"
test "$(docker inspect --format '{{.State.Status}}' "$app_id")" = created
migration_id=$(compose ps -a -q migrate)
test "$(docker inspect --format '{{.State.ExitCode}}' "$migration_id")" != 0
echo "Migration failure correctly blocked application startup"
