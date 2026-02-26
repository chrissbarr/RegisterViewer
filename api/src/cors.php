<?php

declare(strict_types=1);

/**
 * Compute CORS headers based on the request Origin and allowed origins config.
 * Returns empty array if origin is not allowed (no CORS headers emitted).
 */
function computeCorsHeaders(array $config): array
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return [];
    }

    $allowedOrigins = $config['allowed_origins'] ?? [];
    $isDev = ($config['environment'] ?? 'production') !== 'production';

    $matchedOrigin = '';
    if (in_array($origin, $allowedOrigins, true)) {
        $matchedOrigin = $origin;
    } elseif ($isDev && isLocalhostOrigin($origin)) {
        $matchedOrigin = $origin;
    }

    if ($matchedOrigin === '') {
        return [];
    }

    return [
        'Access-Control-Allow-Origin'  => $matchedOrigin,
        'Access-Control-Allow-Methods' => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers' => 'Content-Type, Authorization',
        'Access-Control-Max-Age'       => '86400',
        'Vary'                         => 'Origin',
    ];
}

function isLocalhostOrigin(string $origin): bool
{
    $parsed = parse_url($origin);
    if (!$parsed || !isset($parsed['host'])) {
        return false;
    }
    return $parsed['host'] === 'localhost' || $parsed['host'] === '127.0.0.1';
}
