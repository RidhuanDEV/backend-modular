#!/bin/bash
# Non-executable hooks are sourced by MySQL; isolate options and exit statements.
(
set -Eeuo pipefail
if [[ -z "${RIDHUAN_MYSQL_APP_PASSWORD:-}" ]]; then
  exit 0
fi
# Usernames are identifiers, passwords become hex bytes and are quoted by MySQL.
if [[ ! "${MYSQL_USER:-}" =~ ^[A-Za-z_][A-Za-z0-9_]{0,31}$ ]]; then
  echo 'Invalid application database username' >&2
  exit 1
fi
password_hex=$(printf '%s' "$RIDHUAN_MYSQL_APP_PASSWORD" | od -An -tx1 | tr -d ' \n')
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot --default-character-set=utf8mb4 <<SQL
SET @app_password = CONVERT(0x${password_hex} USING utf8mb4);
SET @alter_user = CONCAT('ALTER USER \'${MYSQL_USER}\'@\'%\' IDENTIFIED BY ', QUOTE(@app_password));
PREPARE app_password_statement FROM @alter_user;
EXECUTE app_password_statement;
DEALLOCATE PREPARE app_password_statement;
SQL
)
