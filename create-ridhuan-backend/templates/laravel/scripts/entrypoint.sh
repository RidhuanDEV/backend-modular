#!/bin/sh
set -eu
umask 077
mkdir -p storage/app/private/uploads storage/framework/cache/data storage/framework/cache/locks storage/framework/views storage/framework/sessions storage/logs bootstrap/cache
# No deployment env/secrets are cached in image layers.
php artisan config:cache --no-ansi
php artisan backend:validate-config --no-ansi
exec "$@"
