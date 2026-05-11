<?php

declare(strict_types=1);

/**
 * POST /api/auth/logout — Revoke the current JWT.
 *
 * Adds the token's jti to the revoked_tokens table so it cannot be reused.
 * Also cleans up expired revocation entries to keep the table small.
 */
function handleAuthLogout(PDO $db, array $auth): ApiResponse
{
    if ($auth['kind'] !== 'jwt') {
        return new ApiResponse(['error' => 'Missing or invalid Authorization header'], 401);
    }

    $jti = $auth['jti'] ?? null;
    if ($jti !== null && is_string($jti)) {
        $expiresAt = utcDbDateTime((int) $auth['exp']);
        dbRevokeToken($db, $jti, $expiresAt);

        // Opportunistic cleanup of expired revocations
        dbCleanupRevokedTokens($db);
    }

    return new ApiResponse(null, 204);
}
