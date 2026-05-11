-- api/database/migrations/002_add_project_version.sql
-- Idempotent so databases that were initialized by raw SQL before the PHP
-- migration runner took ownership can still be brought under _migrations.
SET @project_version_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'projects'
      AND COLUMN_NAME = 'version'
);

SET @add_project_version_sql := IF(
    @project_version_exists = 0,
    'ALTER TABLE projects ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1',
    'SELECT 1'
);

PREPARE add_project_version_stmt FROM @add_project_version_sql;
EXECUTE add_project_version_stmt;
DEALLOCATE PREPARE add_project_version_stmt;
