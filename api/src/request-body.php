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
 * Parse a raw JSON string into the stdClass tree from json_decode().
 *
 * The object tree is the single body representation: it preserves the
 * {} vs [] distinction that associative arrays lose.
 *
 * @return \stdClass|ApiResponse
 */
function parseBody(string $text): \stdClass|ApiResponse
{
    if ($text === '') {
        return new ApiResponse(['error' => 'Invalid JSON body'], 400);
    }

    $object = json_decode($text);
    if (json_last_error() !== JSON_ERROR_NONE || !is_object($object)) {
        return new ApiResponse(['error' => 'Invalid JSON body'], 400);
    }

    return $object;
}

/**
 * Read and parse a required JSON object request body.
 *
 * @return \stdClass|ApiResponse
 */
function readJsonObjectBody(array $server, ?callable $bodyReader = null): \stdClass|ApiResponse
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
 * @return \stdClass|ApiResponse
 */
function resolveParsedBody(\stdClass|\Closure $bodySource): \stdClass|ApiResponse
{
    return $bodySource instanceof \Closure ? $bodySource() : $bodySource;
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
