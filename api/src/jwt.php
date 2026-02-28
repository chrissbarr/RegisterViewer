<?php

declare(strict_types=1);

/**
 * Minimal HMAC-SHA256 JWT implementation.
 *
 * No external library needed — uses PHP's built-in hash_hmac().
 * Tokens contain: sub (user ID), email, iat (issued at), exp (expiry).
 */

const JWT_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

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
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

    $signature = base64UrlEncode(
        hash_hmac('sha256', "$header.$payload", $config['jwt_secret'], true)
    );

    return "$header.$payload.$signature";
}

/**
 * Verify a JWT and return the decoded payload, or null if invalid/expired.
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

    return $payload;
}
