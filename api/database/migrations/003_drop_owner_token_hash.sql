-- Migration: 003_drop_owner_token_hash.sql
-- Description: Remove anonymous token auth. All cloud projects now require
--              email-based JWT authentication with user_id ownership.
--              Existing anonymous projects (user_id IS NULL) become orphaned.
-- Date: 2026-03-02

-- Step 1: Make column nullable (allows overlap during deploy)
ALTER TABLE `projects`
    MODIFY COLUMN `owner_token_hash` CHAR(64) NULL DEFAULT NULL;

-- Step 2: Drop the column and its index
ALTER TABLE `projects`
    DROP INDEX `ix_owner`,
    DROP COLUMN `owner_token_hash`;
