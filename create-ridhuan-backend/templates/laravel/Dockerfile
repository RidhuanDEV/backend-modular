FROM composer:2.9.8@sha256:b09bccd91a78fe8a9ab4b33d707b862e8fe54fec17782e32683ad2a69c46867d AS composer
FROM php:8.5.11-fpm-bookworm@sha256:53eab56a8f43f51a92119f6c29b3448af98eec288ff17f92829354a4b4c9ca05 AS base
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libzip-dev libonig-dev libicu-dev libxml2-dev unzip git ca-certificates \
    && docker-php-ext-install pdo_pgsql pdo_mysql mbstring zip intl pcntl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
WORKDIR /var/www/html
FROM base AS dependencies
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --no-scripts --no-autoloader
FROM base AS app
COPY --from=dependencies /var/www/html/vendor ./vendor
COPY . .
RUN mkdir -p bootstrap/cache storage/app/private/uploads storage/framework/cache/data storage/framework/cache/locks storage/framework/views storage/framework/sessions storage/logs \
    && composer dump-autoload --optimize --no-dev \
    && useradd --uid 1000 --create-home backend \
    && chown -R backend:backend storage bootstrap/cache \
    && chmod +x scripts/entrypoint.sh
COPY scripts/php.ini /usr/local/etc/php/conf.d/backend.ini
COPY scripts/php-fpm.conf /usr/local/etc/php-fpm.d/zz-backend.conf
USER backend
EXPOSE 9000
ENTRYPOINT ["/var/www/html/scripts/entrypoint.sh"]
CMD ["php-fpm", "-F"]
FROM nginx:1.30.5-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS web
COPY scripts/nginx.conf /etc/nginx/nginx.conf
COPY --from=app /var/www/html/public /var/www/html/public
RUN mkdir -p /tmp/nginx && chown -R nginx:nginx /tmp/nginx /var/www/html/public
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
