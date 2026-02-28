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
    `code`       CHAR(6)          NOT NULL,
    `expires_at` DATETIME         NOT NULL,
    `attempts`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `used`       TINYINT(1)       NOT NULL DEFAULT 0,
    `created_at` DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `ix_email_created` (`email`, `created_at` DESC)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='OTP codes for email login';

-- Link projects.user_id to users table
ALTER TABLE `projects`
    ADD CONSTRAINT `fk_projects_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL;
