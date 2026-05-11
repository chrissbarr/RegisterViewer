-- api/database/migrations/003_create_auth_rate_limits.sql
-- Dedicated fixed-window rate-limit buckets for public auth endpoints.

CREATE TABLE IF NOT EXISTS `auth_rate_limits` (
    `scope`         VARCHAR(40)  NOT NULL,
    `identity_hash` CHAR(64)     NOT NULL COMMENT 'SHA-256 hex digest of the scoped identity',
    `bucket_start` DATETIME     NOT NULL,
    `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
    `expires_at`   DATETIME     NOT NULL,
    `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`scope`, `identity_hash`, `bucket_start`),
    KEY `ix_expires_at` (`expires_at`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Fixed-window auth rate-limit buckets';
