#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mode="${1:-http}"
if [ "$#" -gt 0 ]; then shift; fi
exec java -jar target/app.jar "--app.mode=$mode" "$@"
