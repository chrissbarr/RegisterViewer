-- Clear transient auth state written before the API enforced UTC timestamps.
-- Durable user and project data is intentionally preserved.
DELETE FROM login_codes;
DELETE FROM auth_rate_limits;
DELETE FROM revoked_tokens;
