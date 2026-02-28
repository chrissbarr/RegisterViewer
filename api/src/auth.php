<?php

declare(strict_types=1);

/**
 * Check whether a token hash matches the project's owner token hash.
 * Uses hash_equals() for constant-time comparison.
 */
function isOwner(string $tokenHash, array $project): bool
{
    return hash_equals($project['owner_token_hash'], $tokenHash);
}

/**
 * Extract and classify the Authorization header as token hash, JWT, or none.
 *
 * Returns one of:
 *   ['kind' => 'token', 'tokenHash' => string]
 *   ['kind' => 'jwt',   'userId' => int, 'email' => string, 'jti' => ?string, 'exp' => int]
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

    // 64-char lowercase hex = legacy token hash
    $normalized = strtolower($value);
    if (preg_match('/^[0-9a-f]{64}$/', $normalized)) {
        return ['kind' => 'token', 'tokenHash' => $normalized];
    }

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
 * Check if the auth context owns a project (by token hash OR user_id).
 */
function isOwnerOrUser(array $auth, array $project): bool
{
    if ($auth['kind'] === 'token') {
        return hash_equals($project['owner_token_hash'], $auth['tokenHash']);
    }
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
        return new ApiResponse(['error' => 'Missing or invalid Authorization header'], 401);
    }

    $project = dbGetProjectForAuth($db, $id);
    if ($project === null || !isOwnerOrUser($auth, $project)) {
        return new ApiResponse(['error' => 'Project not found'], 404);
    }

    return $project;
}
