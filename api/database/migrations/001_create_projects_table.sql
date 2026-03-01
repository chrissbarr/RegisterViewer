-- Migration: 001_create_projects_table.sql
-- Description: Initial schema for Register Viewer cloud storage
-- Date: 2026-02-25

CREATE TABLE IF NOT EXISTS `projects` (
    `id`                INT UNSIGNED        NOT NULL AUTO_INCREMENT,
    `public_id`         CHAR(12)            NOT NULL COMMENT '12-char base62, used in URLs and API',
    `owner_token_hash`  CHAR(64)            NOT NULL COMMENT 'SHA-256 hex of client-generated owner token',
    `visibility`        ENUM('private', 'unlisted') NOT NULL DEFAULT 'private',
    `title`             VARCHAR(500)        DEFAULT NULL COMMENT 'Copied from data.project.title on save',
    `data`              MEDIUMTEXT          NOT NULL COMMENT 'Full project JSON payload (max ~512KB)',
    `created_at`        DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`        DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `last_accessed_at`  DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `user_id`           INT UNSIGNED        DEFAULT NULL COMMENT 'FK to users.id — required by 002_create_auth_tables.sql',
    `schema_version`    TINYINT UNSIGNED    NOT NULL DEFAULT 1,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_public_id` (`public_id`),
    KEY `ix_owner` (`owner_token_hash`, `updated_at` DESC),
    KEY `ix_visibility` (`visibility`, `updated_at` DESC),
    KEY `ix_user_id` (`user_id`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Cloud-saved register layout projects';
