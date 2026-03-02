-- Migration: 001_initial_schema.sql
-- Description: Full schema for Register Viewer cloud storage with email-based auth
-- Date: 2026-03-02

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

CREATE TABLE IF NOT EXISTS `projects` (
    `id`                INT UNSIGNED        NOT NULL AUTO_INCREMENT,
    `public_id`         CHAR(12)            NOT NULL COMMENT '12-char base62, used in URLs and API',
    `user_id`           INT UNSIGNED        DEFAULT NULL COMMENT 'FK to users.id',
    `visibility`        ENUM('private', 'unlisted') NOT NULL DEFAULT 'private',
    `title`             VARCHAR(500)        DEFAULT NULL COMMENT 'Copied from data.project.title on save',
    `data`              MEDIUMTEXT          NOT NULL COMMENT 'Full project JSON payload (max ~512KB)',
    `created_at`        DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `last_accessed_at`  DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `schema_version`    TINYINT UNSIGNED    NOT NULL DEFAULT 1,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_public_id` (`public_id`),
    KEY `ix_visibility` (`visibility`, `updated_at` DESC),
    KEY `ix_user_updated` (`user_id`, `updated_at` DESC),
    CONSTRAINT `fk_projects_user`
        FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
        ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Cloud-saved register layout projects';

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
