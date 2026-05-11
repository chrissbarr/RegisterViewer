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
 * @param string $codeVerifier HMAC-SHA256 hex verifier of the OTP code (64 chars)
 * @param string|null $ipAddress Client IP address for rate limiting (PERF-15)
 */
function dbCreateLoginCode(PDO $db, string $email, string $codeVerifier, string $expiresAt, ?string $ipAddress = null): void
{
    $now = utcDbDateTime();
    $stmt = $db->prepare(
        'INSERT INTO login_codes (email, code_verifier, expires_at, ip_address, created_at)
         VALUES (:email, :code_verifier, :expires_at, :ip_address, :created_at)'
    );
    $stmt->execute([
        'email'         => $email,
        'code_verifier' => $codeVerifier,
        'expires_at'    => $expiresAt,
        'ip_address'    => $ipAddress,
        'created_at'    => $now,
    ]);
}

/**
 * Get the latest login code for an email with an exclusive row lock.
 * Must be called within a transaction.
 */
function dbGetLatestLoginCodeForUpdate(PDO $db, string $email): ?array
{
    $stmt = $db->prepare(
        'SELECT id, email, code_verifier, expires_at, attempts, used
         FROM login_codes
         WHERE email = :email
         ORDER BY created_at DESC, id DESC
         LIMIT 1
         FOR UPDATE'
    );
    $stmt->execute(['email' => $email]);
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
 * Mark a login code as used.
 */
function dbMarkLoginCodeUsed(PDO $db, int $id): void
{
    $stmt = $db->prepare('UPDATE login_codes SET used = 1 WHERE id = :id');
    $stmt->execute(['id' => $id]);
}

function dbMarkActiveLoginCodesUsed(PDO $db, string $email): void
{
    $now = utcDbDateTime();
    $stmt = $db->prepare(
        'UPDATE login_codes SET used = 1
         WHERE email = :email AND used = 0 AND expires_at > :now'
    );
    $stmt->execute(['email' => $email, 'now' => $now]);
}

/**
 * Count login codes sent to an email in the last hour (rate limiting).
 */
function dbCountRecentLoginCodes(PDO $db, string $email): int
{
    $cutoff = utcDbDateTime(time() - 3600);
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_codes
         WHERE email = :email AND created_at > :cutoff'
    );
    $stmt->execute(['email' => $email, 'cutoff' => $cutoff]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count total login codes sent globally within the given interval.
 * Used as a global rate limit to prevent mass OTP abuse (PERF-15).
 */
function dbCountAllRecentLoginCodes(PDO $db, int $intervalSeconds = 60): int
{
    $cutoff = utcDbDateTime(time() - $intervalSeconds);
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
    $cutoff = utcDbDateTime(time() - $intervalSeconds);
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_codes
         WHERE ip_address = :ip AND created_at > :cutoff'
    );
    $stmt->execute(['ip' => $ipAddress, 'cutoff' => $cutoff]);
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
    $now = utcDbDateTime();
    $createdBefore = utcDbDateTime(time() - 24 * 60 * 60);
    $stmt = $db->prepare(
        'DELETE FROM login_codes
         WHERE (used = 1 OR expires_at < :now)
           AND created_at < :created_before
         LIMIT 10000'
    );
    $stmt->execute(['now' => $now, 'created_before' => $createdBefore]);
    return $stmt->rowCount();
}
