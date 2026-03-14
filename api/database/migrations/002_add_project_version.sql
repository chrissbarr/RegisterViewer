-- api/database/migrations/002_add_project_version.sql
ALTER TABLE projects ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
