#!/bin/sh
# Run inside an isolated Linux runner with disposable PostgreSQL/Redis services.
set -eu
: "${DATABASE_URL:?Provide a disposable PostgreSQL database with CREATEDB permission}"
source_root=$(pwd)
workspace=$(mktemp -d)
api_pid=
cleanup() {
  if [ -n "$api_pid" ]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
go mod download
go run ./cmd/initproject --no-install --source "$source_root" "$workspace/api" < scripts/initproject-smoke-input.txt
cd "$workspace/api"
go test ./...
go build -o "$workspace/api-bin" ./cmd/api
go run ./cmd/migrate
PORT=3111 "$workspace/api-bin" > "$workspace/api.log" 2>&1 &
api_pid=$!
attempt=0
until wget -q -O /dev/null http://127.0.0.1:3111/ready; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then cat "$workspace/api.log"; exit 1; fi
  sleep 1
done
wget -q -O /dev/null http://127.0.0.1:3111/live
wget -q -O /dev/null http://127.0.0.1:3111/docs/openapi.json
echo "Linux initializer: tests, build, migrations and HTTP startup passed"
