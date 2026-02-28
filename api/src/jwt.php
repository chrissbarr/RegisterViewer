<?php

declare(strict_types=1);

/**
 * Minimal HMAC-SHA256 JWT implementation.
 *
 * No external library needed — uses PHP's built-in hash_hmac().
 * Tokens contain: sub (user ID), email, iat (issued at), exp (expiry), jti (token ID).
 */

const JWT_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

function base64UrlEncode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64UrlDecode(string $data): string
{
    return base64_decode(strtr($data, '-_', '+/'), true) ?: '';
}

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

    $header = base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));

    $now = time();
    $payload = base64UrlEncode(json_encode([
        'sub'   => $userId,
        'email' => $email,
        'iat'   => $now,
        'exp'   => $now + JWT_EXPIRY_SECONDS,
        'jti'   => bin2hex(random_bytes(16)),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

    $signature = base64UrlEncode(
        hash_hmac('sha256', "$header.$payload", $config['jwt_secret'], true)
    );

    return "$header.$payload.$signature";
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

    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }

    [$header64, $payload64, $signature64] = $parts;

    // Verify alg header matches expected algorithm
    $headerJson = base64UrlDecode($header64);
    if ($headerJson === '') {
        return null;
    }
    $header = json_decode($headerJson, true);
    if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256') {
        return null;
    }

    // Verify signature (constant-time comparison)
    $expectedSig = base64UrlEncode(
        hash_hmac('sha256', "$header64.$payload64", $config['jwt_secret'], true)
    );
    if (!hash_equals($expectedSig, $signature64)) {
        return null;
    }

    // Decode payload
    $payloadJson = base64UrlDecode($payload64);
    if ($payloadJson === '') {
        return null;
    }

    $payload = json_decode($payloadJson, true);
    if (!is_array($payload)) {
        return null;
    }

    // Check expiry
    if (!isset($payload['exp']) || !is_int($payload['exp']) || $payload['exp'] < time()) {
        return null;
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
