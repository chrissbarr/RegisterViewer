<?php

declare(strict_types=1);

/**
 * Data-access functions for the revoked_tokens table (JWT revocation).
 */

/**
 * Check if a JWT has been revoked by its jti claim.
 */
function dbIsTokenRevoked(PDO $db, string $jti): bool
{
    $stmt = $db->prepare('SELECT 1 FROM revoked_tokens WHERE jti = :jti LIMIT 1');
    $stmt->execute(['jti' => $jti]);
    return (bool) $stmt->fetchColumn();
}

/**
 * Revoke a JWT by storing its jti. The expires_at column allows cleanup.
 */
function dbRevokeToken(PDO $db, string $jti, string $expiresAt): void
{
    $stmt = $db->prepare(
        'INSERT IGNORE INTO revoked_tokens (jti, expires_at) VALUES (:jti, :expires_at)'
    );
    $stmt->execute(['jti' => $jti, 'expires_at' => $expiresAt]);
}

/**
 * Delete revoked tokens whose original JWT has already expired.
 * Safe to call on every logout — bounded by the number of expired entries.
 */
function dbCleanupRevokedTokens(PDO $db): void
{
    $db->exec('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
}
