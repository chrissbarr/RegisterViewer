<?php

declare(strict_types=1);

/**
 * Fixed-window auth rate-limit buckets.
 */

const AUTH_VERIFY_GLOBAL_LIMIT = 100;
const AUTH_VERIFY_GLOBAL_WINDOW_SECONDS = 60;
const AUTH_VERIFY_EMAIL_LIMIT = 10;
const AUTH_VERIFY_EMAIL_WINDOW_SECONDS = 600;
const AUTH_VERIFY_IP_LIMIT = 30;
const AUTH_VERIFY_IP_WINDOW_SECONDS = 600;
const AUTH_RATE_LIMIT_RETENTION_SECONDS = 86400;

/**
 * @return array{allowed: bool, count: int, limit: int, scope: string, bucketStart: string, expiresAt: string}
 */
function dbConsumeAuthRateLimit(
    PDO $db,
    string $scope,
    string $identity,
    int $limit,
    int $windowSeconds,
    ?int $now = null,
): array {
    $now ??= time();
    $bucketEpoch = intdiv($now, $windowSeconds) * $windowSeconds;
    $bucketStart = date('Y-m-d H:i:s', $bucketEpoch);
    $expiresAt = date('Y-m-d H:i:s', $bucketEpoch + $windowSeconds + AUTH_RATE_LIMIT_RETENTION_SECONDS);
    $identityHash = hash('sha256', "$scope:$identity");

    $stmt = $db->prepare(
        'INSERT INTO auth_rate_limits (scope, identity_hash, bucket_start, attempt_count, expires_at)
         VALUES (?, ?, ?, LAST_INSERT_ID(1), ?)
         ON DUPLICATE KEY UPDATE
           attempt_count = LAST_INSERT_ID(attempt_count + 1),
           expires_at = ?,
           updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([$scope, $identityHash, $bucketStart, $expiresAt, $expiresAt]);

    $count = (int) $db->query('SELECT LAST_INSERT_ID()')->fetchColumn();

    return [
        'allowed' => $count <= $limit,
        'count' => $count,
        'limit' => $limit,
        'scope' => $scope,
        'bucketStart' => $bucketStart,
        'expiresAt' => $expiresAt,
    ];
}

function dbPurgeExpiredAuthRateLimitBuckets(PDO $db, int $limit = 10000): int
{
    $stmt = $db->prepare(
        "DELETE FROM auth_rate_limits
         WHERE expires_at < NOW()
         LIMIT $limit"
    );
    $stmt->execute();
    return $stmt->rowCount();
}

function authRateLimitClientIp(array $server): string
{
    $ip = $server['REMOTE_ADDR'] ?? null;
    return is_string($ip) && $ip !== '' ? $ip : '0.0.0.0';
}
