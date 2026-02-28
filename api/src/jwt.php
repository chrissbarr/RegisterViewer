<?php

declare(strict_types=1);

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

/**
 * JWT helpers backed by firebase/php-jwt.
 *
 * Tokens contain: sub (user ID), email, iat (issued at), exp (expiry), jti (token ID).
 * Backward-compatible with tokens issued by the previous custom implementation.
 */

const JWT_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Create a signed JWT for the given user.
 *
 * Includes a `jti` (JWT ID) claim — a 32-char hex string from 16 random bytes.
 * This enables server-side revocation via the `revoked_tokens` table.
 */
function createJwt(array $config, int $userId, string $email): string
{
    if (!isset($config['jwt_secret']) || strlen($config['jwt_secret']) < 32) {
        throw new RuntimeException('JWT secret must be at least 32 characters');
    }

    $now = time();
    $payload = [
        'sub'   => $userId,
        'email' => $email,
        'iat'   => $now,
        'exp'   => $now + JWT_EXPIRY_SECONDS,
        'jti'   => bin2hex(random_bytes(16)),
    ];

    return JWT::encode($payload, $config['jwt_secret'], 'HS256');
}

/**
 * Verify a JWT and return the decoded payload, or null if invalid/expired.
 *
 * Note: This performs cryptographic verification only. Revocation checking
 * requires a DB lookup and is handled by extractAuth() in auth.php.
 */
function verifyJwt(array $config, string $token): ?array
{
    if (!isset($config['jwt_secret']) || strlen($config['jwt_secret']) < 32) {
        return null;
    }

    try {
        $decoded = JWT::decode($token, new Key($config['jwt_secret'], 'HS256'));
    } catch (\Throwable) {
        return null;
    }

    $payload = (array) $decoded;

    // Normalise numeric claims to int (JWT decode may produce float for JSON integers)
    if (isset($payload['sub'])) {
        $payload['sub'] = (int) $payload['sub'];
    }
    if (isset($payload['exp'])) {
        $payload['exp'] = (int) $payload['exp'];
    }
    if (isset($payload['iat'])) {
        $payload['iat'] = (int) $payload['iat'];
    }

    // Validate required fields
    if (!isset($payload['sub']) || !is_int($payload['sub'])) {
        return null;
    }
    if (!isset($payload['email']) || !is_string($payload['email'])) {
        return null;
    }

    // Validate jti type if present (optional claim, but must be string when set)
    if (isset($payload['jti']) && !is_string($payload['jti'])) {
        return null;
    }

    return $payload;
}
