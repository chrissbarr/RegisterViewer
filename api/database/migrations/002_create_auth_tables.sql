-- Migration: 002_create_auth_tables.sql
-- Description: Add users table, login_codes table, and FK from projects.user_id
-- Date: 2026-02-28

CREATE TABLE IF NOT EXISTS `users` (
    `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `email`      VARCHAR(254) NOT NULL,
    `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_email` (`email`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Registered users (email-based auth)';

CREATE TABLE IF NOT EXISTS `login_codes` (
    `id`         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    `email`      VARCHAR(254)     NOT NULL,
    `code`       CHAR(64)         NOT NULL COMMENT 'SHA-256 hash of OTP code',
    `expires_at` DATETIME         NOT NULL,
    `attempts`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `used`       TINYINT(1)       NOT NULL DEFAULT 0,
    `ip_address` VARCHAR(45)      DEFAULT NULL COMMENT 'Client IP (IPv4 or IPv6)',
    `created_at` DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `ix_email_created` (`email`, `created_at` DESC),
    KEY `ix_email_code_active` (`email`, `code`, `used`, `expires_at`),
    KEY `ix_ip_created` (`ip_address`, `created_at` DESC),
    KEY `ix_created` (`created_at`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='OTP codes for email login';

-- Link projects.user_id → users.id
-- Prerequisite: projects.user_id column must exist (created in 001_create_projects_table.sql).
-- The migration runner (database/migrate.php) sorts files lexicographically,
-- so zero-padded numeric prefixes guarantee 001 always runs before 002.
-- Do NOT remove user_id from migration 001.
ALTER TABLE `projects`
    ADD CONSTRAINT `fk_projects_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL;

-- Revoked JWT tokens (for server-side logout / token invalidation)
CREATE TABLE IF NOT EXISTS `revoked_tokens` (
    `jti`        CHAR(32)     NOT NULL COMMENT 'JWT ID (hex, 16 random bytes)',
    `expires_at` DATETIME     NOT NULL COMMENT 'Original token expiry (for cleanup)',
    `revoked_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`jti`),
    KEY `ix_expires_at` (`expires_at`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Revoked JWTs — checked on every authenticated request';
