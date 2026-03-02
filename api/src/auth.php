<?php

declare(strict_types=1);

/**
 * Extract and classify the Authorization header as JWT or none.
 *
 * Returns one of:
 *   ['kind' => 'jwt',  'userId' => int, 'email' => string, 'jti' => ?string, 'exp' => int]
 *   ['kind' => 'none']
 *
 * When $db is provided, JWT tokens are checked against the revoked_tokens table.
 * Pass null for $db in unit tests to skip the revocation check.
 */
function extractAuth(array $config, ?PDO $db = null): array
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (empty($header)) {
        $header = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    }
    if (empty($header)) {
        return ['kind' => 'none'];
    }

    $parts = explode(' ', $header, 2);
    if (count($parts) !== 2 || $parts[0] !== 'Bearer') {
        return ['kind' => 'none'];
    }

    $value = $parts[1];

    // JWT format: three dot-separated segments
    if (substr_count($value, '.') === 2) {
        $payload = verifyJwt($config, $value);
        if ($payload !== null) {
            // Check revocation if DB is available and jti is present
            $jti = $payload['jti'] ?? null;
            if ($jti !== null && is_string($jti) && $db !== null) {
                if (dbIsTokenRevoked($db, $jti)) {
                    return ['kind' => 'none'];
                }
            }
            return [
                'kind'   => 'jwt',
                'userId' => $payload['sub'],
                'email'  => $payload['email'],
                'jti'    => $jti,
                'exp'    => $payload['exp'],
            ];
        }
    }

    return ['kind' => 'none'];
}

/**
 * Check if the authenticated user owns a project (by user_id).
 */
function isProjectOwner(array $auth, array $project): bool
{
    if ($auth['kind'] === 'jwt') {
        return $project['user_id'] !== null && (int) $project['user_id'] === $auth['userId'];
    }
    return false;
}

/**
 * Verify auth and project ownership. Returns the project row on success,
 * or an ApiResponse error on failure.
 *
 * @return array|ApiResponse
 */
function requireOwnership(PDO $db, string $id, array $auth): array|ApiResponse
{
    if ($auth['kind'] === 'none') {
        return new ApiResponse(['error' => 'Authentication required'], 401);
    }

    $project = dbGetProjectForAuth($db, $id);
    if ($project === null || !isProjectOwner($auth, $project)) {
        return new ApiResponse(['error' => 'Project not found'], 404);
    }

    return $project;
}
