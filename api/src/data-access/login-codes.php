<?php

declare(strict_types=1);

/**
 * Data-access functions for the login_codes table (OTP management).
 */

// ---- OTP constants ----

/** Maximum OTP codes per email per hour. */
const OTP_RATE_LIMIT_PER_HOUR = 3;

/** OTP code validity window in seconds (10 minutes). */
const OTP_EXPIRY_SECONDS = 600;

/** Maximum verification attempts per OTP code before lockout. */
const OTP_MAX_ATTEMPTS = 5;

// ---- Login code queries ----

/**
 * Store a login OTP code.
 *
 * @param string $code SHA-256 hex digest of the OTP code (64 chars)
 * @param string|null $ipAddress Client IP address for rate limiting (PERF-15)
 */
function dbCreateLoginCode(PDO $db, string $email, string $code, string $expiresAt, ?string $ipAddress = null): void
{
    $stmt = $db->prepare(
        'INSERT INTO login_codes (email, code, expires_at, ip_address)
         VALUES (:email, :code, :expires_at, :ip_address)'
    );
    $stmt->execute([
        'email'      => $email,
        'code'       => $code,
        'expires_at' => $expiresAt,
        'ip_address' => $ipAddress,
    ]);
}

/**
 * Get an active (unused, unexpired, under attempt limit) login code.
 *
 * @param string $code SHA-256 hex digest of the OTP code to match (64 chars)
 */
function dbGetActiveLoginCode(PDO $db, string $email, string $code, int $maxAttempts = OTP_MAX_ATTEMPTS): ?array
{
    $stmt = $db->prepare(
        'SELECT id, email, code, expires_at, attempts
         FROM login_codes
         WHERE email = :email AND code = :code AND used = 0
           AND expires_at > NOW() AND attempts < :max_attempts
         ORDER BY created_at DESC
         LIMIT 1'
    );
    $stmt->execute(['email' => $email, 'code' => $code, 'max_attempts' => $maxAttempts]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Get an active login code with an exclusive row lock (FOR UPDATE).
 * Must be called within a transaction. Prevents concurrent verify-code
 * requests from both reading the same code as "active" (SEC-N01).
 *
 * @param string $code SHA-256 hex digest of the OTP code to match (64 chars)
 */
function dbGetActiveLoginCodeForUpdate(PDO $db, string $email, string $code, int $maxAttempts = OTP_MAX_ATTEMPTS): ?array
{
    $stmt = $db->prepare(
        'SELECT id, email, code, expires_at, attempts
         FROM login_codes
         WHERE email = :email AND code = :code AND used = 0
           AND expires_at > NOW() AND attempts < :max_attempts
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE'
    );
    $stmt->execute(['email' => $email, 'code' => $code, 'max_attempts' => $maxAttempts]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Increment the attempt counter on a login code.
 */
function dbIncrementLoginCodeAttempts(PDO $db, int $id): void
{
    $stmt = $db->prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = :id');
    $stmt->execute(['id' => $id]);
}

/**
 * Increment attempts on the most recent active code for an email.
 * Used to track failed guesses (wrong code) against the global rate limit.
 */
function dbIncrementMostRecentLoginCodeAttempts(PDO $db, string $email): void
{
    $stmt = $db->prepare(
        'UPDATE login_codes SET attempts = attempts + 1
         WHERE email = :email AND used = 0 AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1'
    );
    $stmt->execute(['email' => $email]);
}

/**
 * Mark a login code as used.
 */
function dbMarkLoginCodeUsed(PDO $db, int $id): void
{
    $stmt = $db->prepare('UPDATE login_codes SET used = 1 WHERE id = :id');
    $stmt->execute(['id' => $id]);
}

/**
 * Count login codes sent to an email in the last hour (rate limiting).
 */
function dbCountRecentLoginCodes(PDO $db, string $email): int
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_codes
         WHERE email = :email AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
    );
    $stmt->execute(['email' => $email]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count total verification attempts for an email in the last 10 minutes.
 * Sums the attempts column across all recent codes (not just a single code).
 * Used as a global rate limit on the verify endpoint.
 */
function dbCountRecentVerifyAttempts(PDO $db, string $email): int
{
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(attempts), 0) FROM login_codes
         WHERE email = :email AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)'
    );
    $stmt->execute(['email' => $email]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count total login codes sent globally within the given interval.
 * Used as a global rate limit to prevent mass OTP abuse (PERF-15).
 */
function dbCountAllRecentLoginCodes(PDO $db, int $intervalSeconds = 60): int
{
    $cutoff = gmdate('Y-m-d H:i:s', time() - $intervalSeconds);
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_codes WHERE created_at > :cutoff'
    );
    $stmt->execute(['cutoff' => $cutoff]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count login codes sent from a specific IP within the given interval.
 * Used for per-IP rate limiting to prevent spam relay abuse (PERF-15).
 */
function dbCountRecentLoginCodesByIp(PDO $db, string $ipAddress, int $intervalSeconds = 900): int
{
    $cutoff = gmdate('Y-m-d H:i:s', time() - $intervalSeconds);
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_codes
         WHERE ip_address = :ip AND created_at > :cutoff'
    );
    $stmt->execute(['ip' => $ipAddress, 'cutoff' => $cutoff]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count total verification attempts globally within the given interval.
 * Sums the attempts column across all recent codes.
 * Used as a global rate limit on the verify endpoint (PERF-15).
 */
function dbCountAllRecentVerifyAttempts(PDO $db, int $intervalSeconds = 60): int
{
    $cutoff = gmdate('Y-m-d H:i:s', time() - $intervalSeconds);
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(attempts), 0) FROM login_codes WHERE created_at > :cutoff'
    );
    $stmt->execute(['cutoff' => $cutoff]);
    return (int) $stmt->fetchColumn();
}

/**
 * Purge expired and used login codes older than 24 hours.
 * Keeps the login_codes table bounded by removing rows that are no longer
 * useful for verification or rate-limit accounting. Uses LIMIT to avoid
 * holding a table lock for too long on large backlogs.
 *
 * @return int Number of rows deleted
 */
function dbPurgeExpiredLoginCodes(PDO $db): int
{
    $stmt = $db->prepare(
        'DELETE FROM login_codes
         WHERE (used = 1 OR expires_at < NOW())
           AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
         LIMIT 10000'
    );
    $stmt->execute();
    return $stmt->rowCount();
}
