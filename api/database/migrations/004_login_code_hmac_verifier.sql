-- api/database/migrations/004_login_code_hmac_verifier.sql
-- Store OTP verifiers as keyed HMAC digests and invalidate pre-HMAC codes.

SET @ix_email_code_active_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'login_codes'
      AND INDEX_NAME = 'ix_email_code_active'
);

SET @drop_ix_email_code_active_sql := IF(
    @ix_email_code_active_exists > 0,
    'ALTER TABLE login_codes DROP INDEX ix_email_code_active',
    'SELECT 1'
);

PREPARE drop_ix_email_code_active_stmt FROM @drop_ix_email_code_active_sql;
EXECUTE drop_ix_email_code_active_stmt;
DEALLOCATE PREPARE drop_ix_email_code_active_stmt;

SET @login_code_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'login_codes'
      AND COLUMN_NAME = 'code'
);

SET @login_code_verifier_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'login_codes'
      AND COLUMN_NAME = 'code_verifier'
);

SET @invalidate_legacy_login_codes_sql := IF(
    @login_code_column_exists > 0 AND @login_code_verifier_column_exists = 0,
    'UPDATE login_codes SET used = 1 WHERE used = 0',
    'SELECT 1'
);

PREPARE invalidate_legacy_login_codes_stmt FROM @invalidate_legacy_login_codes_sql;
EXECUTE invalidate_legacy_login_codes_stmt;
DEALLOCATE PREPARE invalidate_legacy_login_codes_stmt;

SET @rename_login_code_sql := IF(
    @login_code_column_exists > 0 AND @login_code_verifier_column_exists = 0,
    'ALTER TABLE login_codes CHANGE COLUMN code code_verifier CHAR(64) NOT NULL COMMENT ''HMAC-SHA256 verifier of OTP code''',
    'SELECT 1'
);

PREPARE rename_login_code_stmt FROM @rename_login_code_sql;
EXECUTE rename_login_code_stmt;
DEALLOCATE PREPARE rename_login_code_stmt;

SET @login_code_verifier_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'login_codes'
      AND COLUMN_NAME = 'code_verifier'
);

SET @modify_login_code_verifier_sql := IF(
    @login_code_verifier_column_exists > 0,
    'ALTER TABLE login_codes MODIFY COLUMN code_verifier CHAR(64) NOT NULL COMMENT ''HMAC-SHA256 verifier of OTP code''',
    'SELECT 1'
);

PREPARE modify_login_code_verifier_stmt FROM @modify_login_code_verifier_sql;
EXECUTE modify_login_code_verifier_stmt;
DEALLOCATE PREPARE modify_login_code_verifier_stmt;

SET @ix_email_created_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'login_codes'
      AND INDEX_NAME = 'ix_email_created'
);

SET @drop_ix_email_created_sql := IF(
    @ix_email_created_exists > 0,
    'ALTER TABLE login_codes DROP INDEX ix_email_created',
    'SELECT 1'
);

PREPARE drop_ix_email_created_stmt FROM @drop_ix_email_created_sql;
EXECUTE drop_ix_email_created_stmt;
DEALLOCATE PREPARE drop_ix_email_created_stmt;

SET @ix_login_codes_email_latest_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'login_codes'
      AND INDEX_NAME = 'ix_login_codes_email_latest'
);

SET @add_ix_login_codes_email_latest_sql := IF(
    @ix_login_codes_email_latest_exists = 0,
    'ALTER TABLE login_codes ADD INDEX ix_login_codes_email_latest (email, created_at DESC, id DESC)',
    'SELECT 1'
);

PREPARE add_ix_login_codes_email_latest_stmt FROM @add_ix_login_codes_email_latest_sql;
EXECUTE add_ix_login_codes_email_latest_stmt;
DEALLOCATE PREPARE add_ix_login_codes_email_latest_stmt;

SET @ix_login_codes_email_active_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'login_codes'
      AND INDEX_NAME = 'ix_login_codes_email_active'
);

SET @add_ix_login_codes_email_active_sql := IF(
    @ix_login_codes_email_active_exists = 0,
    'ALTER TABLE login_codes ADD INDEX ix_login_codes_email_active (email, used, expires_at)',
    'SELECT 1'
);

PREPARE add_ix_login_codes_email_active_stmt FROM @add_ix_login_codes_email_active_sql;
EXECUTE add_ix_login_codes_email_active_stmt;
DEALLOCATE PREPARE add_ix_login_codes_email_active_stmt;
