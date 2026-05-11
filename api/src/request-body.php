<?php

declare(strict_types=1);

/**
 * Read the request body with the API payload size limit enforced.
 *
 * @param callable|null $bodyReader Test seam returning the raw request body.
 */
function readBody(array $server, ?callable $bodyReader = null): string|ApiResponse
{
    $contentLength = $server['HTTP_CONTENT_LENGTH'] ?? $server['CONTENT_LENGTH'] ?? null;
    if ($contentLength !== null && (int) $contentLength > LIMITS['MAX_PAYLOAD_SIZE']) {
        return new ApiResponse(
            ['error' => 'Request body must be at most ' . LIMITS['MAX_PAYLOAD_SIZE'] . ' bytes'],
            400
        );
    }

    if ($bodyReader === null) {
        $rawBody = file_get_contents('php://input', false, null, 0, LIMITS['MAX_PAYLOAD_SIZE'] + 1);
    } else {
        $rawBody = $bodyReader();
    }

    if ($rawBody === false || $rawBody === null) {
        $rawBody = '';
    }
    if (!is_string($rawBody)) {
        $rawBody = '';
    }

    if (strlen($rawBody) > LIMITS['MAX_PAYLOAD_SIZE']) {
        return new ApiResponse(
            ['error' => 'Request body must be at most ' . LIMITS['MAX_PAYLOAD_SIZE'] . ' bytes'],
            400
        );
    }

    return $rawBody;
}

/**
 * Parse a raw JSON string into both associative-array and stdClass views.
 *
 * @return array{assoc: array, object: object}|ApiResponse
 */
function parseBody(string $text): array|ApiResponse
{
    if ($text === '') {
        return new ApiResponse(['error' => 'Invalid JSON body'], 400);
    }

    $object = json_decode($text);
    if (json_last_error() !== JSON_ERROR_NONE || !is_object($object)) {
        return new ApiResponse(['error' => 'Invalid JSON body'], 400);
    }

    return ['assoc' => objectToAssoc($object), 'object' => $object];
}

/**
 * Read and parse a required JSON object request body.
 *
 * @return array{assoc: array, object: object}|ApiResponse
 */
function readJsonObjectBody(array $server, ?callable $bodyReader = null): array|ApiResponse
{
    $raw = readBody($server, $bodyReader);
    if ($raw instanceof ApiResponse) {
        return $raw;
    }
    return parseBody($raw);
}

/**
 * Resolve an already parsed body or lazy body provider.
 *
 * @return array{assoc: array, object: object}|ApiResponse
 */
function resolveParsedBody(array|\Closure $bodySource): array|ApiResponse
{
    $parsed = $bodySource instanceof \Closure ? $bodySource() : $bodySource;
    if ($parsed instanceof ApiResponse) {
        return $parsed;
    }
    return $parsed;
}

/**
 * Resolve a body source to an associative request body.
 *
 * @return array|ApiResponse
 */
function resolveAssocBody(array|\Closure $bodySource): array|ApiResponse
{
    $body = resolveParsedBody($bodySource);
    if ($body instanceof ApiResponse) {
        return $body;
    }
    if (array_key_exists('assoc', $body) && is_array($body['assoc'])) {
        return $body['assoc'];
    }
    return $body;
}

/**
 * Recursively convert a stdClass tree to associative arrays.
 * Arrays are preserved as arrays; stdClass objects become associative arrays.
 */
function objectToAssoc(mixed $value): mixed
{
    if ($value instanceof \stdClass) {
        $result = [];
        foreach ($value as $k => $v) {
            $result[$k] = objectToAssoc($v);
        }
        return $result;
    }
    if (is_array($value)) {
        return array_map('objectToAssoc', $value);
    }
    return $value;
}

/**
 * Extract the "data" field from the parsed request body as a JSON string,
 * using the stdClass view to preserve {} vs [] distinction.
 *
 * @return string|ApiResponse
 */
function extractDataJson(object $parsedObject): string|ApiResponse
{
    if (!property_exists($parsedObject, 'data')) {
        return new ApiResponse(['error' => 'Invalid JSON body'], 400);
    }
    return json_encode($parsedObject->data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
