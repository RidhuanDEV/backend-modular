#!/bin/sh
set -eu
attempt=0
until mc alias set dev http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then echo "S3 fixture unavailable" >&2; exit 1; fi
  sleep 2
done
mc mb --ignore-existing "dev/$S3_BUCKET"
