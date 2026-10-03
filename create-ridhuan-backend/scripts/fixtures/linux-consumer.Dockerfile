# Local consumer verification: install from the tarball in a fresh Linux filesystem.
FROM node:24.19.0-bookworm-slim AS node
FROM eclipse-temurin:25-jdk AS java
FROM golang:1.27.1-bookworm AS go
FROM ghcr.io/astral-sh/uv:0.12.21 AS uv
FROM composer:2.9.8@sha256:b09bccd91a78fe8a9ab4b33d707b862e8fe54fec17782e32683ad2a69c46867d AS composer
FROM php:8.5.11-fpm-bookworm@sha256:53eab56a8f43f51a92119f6c29b3448af98eec288ff17f92829354a4b4c9ca05 AS php-runtime
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libzip-dev libonig-dev patchelf \
    && docker-php-ext-install pdo_pgsql pdo_mysql mbstring zip \
    && mkdir -p /opt/php/bin /opt/php/lib /opt/php/ext /opt/php/conf \
    && cp /usr/local/bin/php /opt/php/bin/php \
    && cp /usr/local/lib/php/extensions/*/*.so /opt/php/ext/ \
    && ldd /opt/php/bin/php /opt/php/ext/*.so | awk '/=> \// {print $3} /^[[:space:]]*\/[^:]* \(/ {print $1}' | sort -u | xargs -I '{}' cp -L '{}' /opt/php/lib/ \
    && loader="$(find /opt/php/lib -name 'ld-linux*.so*' -type f -print -quit)" \
    && patchelf --set-interpreter "$loader" --force-rpath --set-rpath /opt/php/lib /opt/php/bin/php \
    && for extension in /opt/php/ext/*.so; do patchelf --force-rpath --set-rpath /opt/php/lib "$extension"; done \
    && printf '%s\n' 'extension_dir=/opt/php/ext' 'extension=pdo_pgsql' 'extension=pdo_mysql' 'extension=mbstring' 'extension=zip' 'memory_limit=1G' 'date.timezone=UTC' > /opt/php/conf/php.ini
FROM mcr.microsoft.com/dotnet/sdk:10.0.401 AS dotnet-consumer
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /verification
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY dist ./dist
COPY scripts ./scripts
ENTRYPOINT ["node", "scripts/verify-consumer.mjs"]

FROM dotnet-consumer AS full-consumer
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
COPY --from=php-runtime /opt/php /opt/php
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
RUN printf '#!/bin/sh\nexec /opt/php/bin/php -c /opt/php/conf/php.ini "$@"\n' > /usr/local/bin/php && chmod +x /usr/local/bin/php
ENV PHP_INI_SCAN_DIR=/opt/php/conf.d
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:$PATH"
COPY --from=go /usr/local/go /usr/local/go
COPY --from=uv /uv /usr/local/bin/uv
ENV PATH="/usr/local/go/bin:/usr/local/bin:$PATH" GOMAXPROCS=2 GOMEMLIMIT=512MiB UV_LINK_MODE=copy UV_PYTHON_INSTALL_DIR=/opt/python
RUN uv python install 3.13.3
ENV PATH="/opt/python/cpython-3.13-linux-x86_64-gnu/bin:$PATH"
