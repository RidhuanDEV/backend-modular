# Published dependency ledger

The optional docs browser UI loads `@scalar/api-reference`1.36.1 from its pinned jsDelivr npm URL. Published npm metadata confirms MIT and integrity `sha512-WVJvO59Qv9RdFiFwHVO5Z7X3S3E7f06ARE5SydIPSkRH+G37W2x06KC2dJjbuzIp0FD+XJMlCH9PgbexUjhsCg==`; API/OpenAPI JSON works independently of the external browser asset.

Resolved with Composer2.9.8 on official PHP8.5.11 NTS x64, 3 October2026. Official laravel/laravel v13.0.0 skeleton was bootstrapped with create-project --no-install --no-scripts; no default SQLite migration/setup scripts retained. Stable published versions below were actually resolved and installed, not inferred from a main branch. composer.lock is authoritative and install uses it. PHP extensions are checked by Composer and CLI; optional Redis/OTel extensions are not baseline requirements.

| Package | Locked version | License | Source |
| --- | --- | --- | --- |
| aws/aws-sdk-php | 3.399.1 | Apache-2.0 | https://github.com/aws/aws-sdk-php.git |
| dedoc/scramble | v0.13.47 | MIT | https://github.com/dedoc/scramble.git |
| firebase/php-jwt | v7.2.1 | BSD-3-Clause | https://github.com/googleapis/php-jwt.git |
| laravel/framework | v13.34.0 | MIT | https://github.com/laravel/framework.git |
| league/flysystem-aws-s3-v3 | 3.35.3 | MIT | https://github.com/thephpleague/flysystem-aws-s3-v3.git |
| open-telemetry/api | 1.10.0 | Apache-2.0 | https://github.com/opentelemetry-php/api.git |
| open-telemetry/exporter-otlp | 1.4.0 | Apache-2.0 | https://github.com/opentelemetry-php/exporter-otlp.git |
| open-telemetry/sdk | 1.15.0 | Apache-2.0 | https://github.com/opentelemetry-php/sdk.git |
| predis/predis | v3.6.1 | MIT | https://github.com/predis/predis.git |
| symfony/mailer | v8.1.7 | MIT | https://github.com/symfony/mailer.git |
| larastan/larastan | v3.12.2 | MIT | https://github.com/larastan/larastan.git |
| laravel/pint | v1.32.1 | MIT | https://github.com/laravel/pint.git |
| phpunit/phpunit | 12.5.37 | BSD-3-Clause | https://github.com/sebastianbergmann/phpunit.git |

JWT signing/verification uses maintained firebase/php-jwt SDK, no custom cryptography. Scramble is third party, automatic request/resource/schema inference plus bounded policy/SSE/media extensions. Laravel Hash/Storage/Mail and maintained Flysystem/AWS/Symfony adapters supply native transports. OTel packages are official project API/SDK/exporter. Larastan max/Pint/PHPUnit are development-only. Composer plugins explicitly allow php-http/discovery; stable only.

Docker PHP8.5.11 FPM Bookworm index sha256:53eab56a8f43f51a92119f6c29b3448af98eec288ff17f92829354a4b4c9ca05, Composer2.9.8 index sha256:b09bccd91a78fe8a9ab4b33d707b862e8fe54fec17782e32683ad2a69c46867d, Nginx1.30.5 Alpine index sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 were verified in published registry. Fixture helper MinIO/MySQL scripts derive from current Go template; no user environment/data copied.

## Development formatting

Prettier 3.8.1 and `@prettier/plugin-php` 0.25.0 are pinned in `package-lock.json`. The published plugin peer requirement is Prettier ^3.0.0. Formatting is limited to pure PHP source, as recommended by [the plugin maintainers](https://github.com/prettier/plugin-php). Node tooling is optional for runtime deployment.
