# Setup

Follow README commands on Windows/Linux. PHP8.5 x64/Composer2.9.8 and selected PDO extension are required; Composer install uses composer.lock. Run backend:initialize once; configure DB before migration. .env and runtime storage/cached config/vendor stay ignored. APP_KEY base64 random32 bytes is only Laravel crypto; JWT_SECRET separate random48 bytes signs access. Password bcrypt cost12 permits6 characters to72 UTF8 bytes. Login boundary also refuses over72 bytes.

DB usernames/database names are ASCII identifiers: PostgreSQL63 bytes, MySQL username32/database64. Provision dedicated app account; no root runtime. MySQL Compose initializer handles quoted/Unicode passwords through server quoting. Production credentials/origins must be real values. Optional Redis/S3/SMTP/OTel are env switches, not an admin runtime configuration interface.

Use a dedicated immutable `S3_PREFIX` per application database; the CLI initializes it from the deployment name. Native Flysystem scopes put/read/list/delete to that prefix. Never reuse a prefix between unrelated databases. Changing bucket/prefix needs explicit object relocation; env redeployment does not move existing files. Uploads verify the bucket with native AWS HeadBucket; credentials need that permission plus object read/write/delete/list. SDK HTTP connect/request budgets are2s/10s with one retry. Cleanup only recognizes valid generated UUID keys inside the configured private disk/prefix.

Selected provider cannot be changed in a generated backend-template.json project. Changing env does not convert data. SQL_TLS policy is deployment specific: PostgreSQL sslmode verify-full and trusted CA; MySQL MYSQL_SSL_CA verified transport. For manual service dependencies, expose only loopback ports.
