FROM php:8.4-apache AS base

# Enable Apache mod_rewrite for .htaccess URL routing
RUN a2enmod rewrite

# Install PDO MySQL extension
RUN docker-php-ext-install pdo_mysql

# Allow .htaccess overrides (required for API routing)
RUN sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# Set document root to /var/www/html (default, but explicit)
ENV APACHE_DOCUMENT_ROOT=/var/www/html

# ---- Test stage: adds Composer + PHPUnit ----
FROM base AS test

RUN apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www/html
COPY composer.json composer.lock ./
RUN composer install --no-interaction
