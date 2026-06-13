<?php

declare(strict_types=1);

final class ApiResponse
{
    public function __construct(
        public readonly ?array $body,
        public readonly int $status = 200,
        public readonly array $headers = [],
        public readonly ?string $rawJson = null,
    ) {}
}

/**
 * Apply the API-wide caching default: every response is `Cache-Control:
 * no-store` unless a handler explicitly opted in (the key check is
 * case-insensitive so an explicit header is never clobbered or duplicated).
 */
function withDefaultCacheControl(array $headers): array
{
    foreach (array_keys($headers) as $key) {
        if (strcasecmp((string) $key, 'Cache-Control') === 0) {
            return $headers;
        }
    }

    $headers['Cache-Control'] = 'no-store';
    return $headers;
}

function schemaNotReadyResponse(): ApiResponse
{
    return new ApiResponse([
        'error' => 'Service temporarily unavailable',
        'code' => 'schema_not_ready',
    ], 503, ['Retry-After' => '5']);
}
