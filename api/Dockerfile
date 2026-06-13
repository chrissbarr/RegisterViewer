FROM php:8.3-apache AS base

# Enable Apache mod_rewrite for .htaccess URL routing
RUN a2enmod rewrite

# Install runtime extensions required by composer.json and the API code.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4-openssl-dev libonig-dev \
    && docker-php-ext-install curl mbstring pdo_mysql \
    && rm -rf /var/lib/apt/lists/*

# Allow .htaccess overrides (required for API routing)
RUN sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# Set document root to /var/www/html (default, but explicit)
ENV APACHE_DOCUMENT_ROOT=/var/www/html

# ---- Test stage: adds Composer + PHPUnit ----
FROM base AS test

RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html
COPY composer.json composer.lock ./
RUN composer install --no-interaction
