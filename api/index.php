<?php

declare(strict_types=1);

// ---- Bootstrap ----

$config = require __DIR__ . '/config.php';
$prodConfigPath = __DIR__ . '/config.production.php';
if (file_exists($prodConfigPath)) {
    $config = array_replace_recursive($config, require $prodConfigPath);
}

require __DIR__ . '/src/api-response.php';
require __DIR__ . '/src/database.php';
require __DIR__ . '/src/cors.php';
require __DIR__ . '/src/auth.php';
require __DIR__ . '/src/jwt.php';
require __DIR__ . '/src/email.php';
require __DIR__ . '/src/validation.php';
require __DIR__ . '/src/data-access.php';
require __DIR__ . '/src/id.php';
require __DIR__ . '/src/handlers/create-project.php';
require __DIR__ . '/src/handlers/get-project.php';
require __DIR__ . '/src/handlers/update-project.php';
require __DIR__ . '/src/handlers/patch-project.php';
require __DIR__ . '/src/handlers/delete-project.php';
require __DIR__ . '/src/handlers/list-projects.php';
require __DIR__ . '/src/handlers/auth-send-code.php';
require __DIR__ . '/src/handlers/auth-verify-code.php';
require __DIR__ . '/src/handlers/auth-me.php';

// ---- Constants ----

const SECURITY_HEADERS = [
    'X-Content-Type-Options'    => 'nosniff',
    'Referrer-Policy'           => 'no-referrer',
    'X-Frame-Options'           => 'DENY',
    'Content-Security-Policy'   => "default-src 'none'",
];

// ---- Response helpers ----

function sendJson(array|object $body, int $status = 200, array $extraHeaders = []): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    foreach (SECURITY_HEADERS as $k => $v) {
        header("$k: $v");
    }
    foreach ($extraHeaders as $k => $v) {
        header("$k: $v");
    }
    $output = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    header('Content-Length: ' . strlen($output));
    echo $output;
    exit;
}

/**
 * Send a raw JSON string as the response body (avoids decode/re-encode round-trip).
 */
function sendRawJson(string $json, int $status = 200, array $extraHeaders = []): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    foreach (SECURITY_HEADERS as $k => $v) {
        header("$k: $v");
    }
    foreach ($extraHeaders as $k => $v) {
        header("$k: $v");
    }
    header('Content-Length: ' . strlen($json));
    echo $json;
    exit;
}

function sendError(string $message, int $status, array $extraHeaders = []): never
{
    sendJson(['error' => $message], $status, $extraHeaders);
}

function sendNoContent(array $extraHeaders = []): never
{
    http_response_code(204);
    foreach (SECURITY_HEADERS as $k => $v) {
        header("$k: $v");
    }
    foreach ($extraHeaders as $k => $v) {
        header("$k: $v");
    }
    exit;
}

/**
 * Emit an ApiResponse as HTTP output. This is the single I/O exit point.
 */
function emitResponse(ApiResponse $response): never
{
    if ($response->body === null && $response->rawJson === null) {
        // 204 No Content
        http_response_code($response->status);
        foreach (SECURITY_HEADERS as $k => $v) {
            header("$k: $v");
        }
        foreach ($response->headers as $k => $v) {
            header("$k: $v");
        }
        exit;
    }

    http_response_code($response->status);
    header('Content-Type: application/json');
    foreach (SECURITY_HEADERS as $k => $v) {
        header("$k: $v");
    }
    foreach ($response->headers as $k => $v) {
        header("$k: $v");
    }

    $output = $response->rawJson
        ?? json_encode($response->body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    header('Content-Length: ' . strlen($output));
    echo $output;
    exit;
}

// ---- Body reading ----

function readBody(): string|ApiResponse
{
    static $rawBody = null;
    if ($rawBody !== null) {
        return $rawBody;
    }

    // Check Content-Length header first (fast path)
    $contentLength = $_SERVER['HTTP_CONTENT_LENGTH'] ?? $_SERVER['CONTENT_LENGTH'] ?? null;
    if ($contentLength !== null && (int) $contentLength > LIMITS['MAX_PAYLOAD_SIZE']) {
        return new ApiResponse(
            ['error' => 'Request body must be at most ' . LIMITS['MAX_PAYLOAD_SIZE'] . ' bytes'],
            400
        );
    }

    $rawBody = file_get_contents('php://input', false, null, 0, LIMITS['MAX_PAYLOAD_SIZE'] + 1);
    if ($rawBody === false) {
        $rawBody = '';
    }
    if (strlen($rawBody) > LIMITS['MAX_PAYLOAD_SIZE']) {
        $rawBody = null; // Don't cache the oversized body
        return new ApiResponse(
            ['error' => 'Request body must be at most ' . LIMITS['MAX_PAYLOAD_SIZE'] . ' bytes'],
            400
        );
    }

    return $rawBody;
}

/**
 * Parse a raw JSON string into both associative-array and stdClass views.
 * Returns ApiResponse on error, or the parsed array on success.
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

// ---- HSTS (production only) ----

if ($config['environment'] === 'production') {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

// ---- CORS ----

$corsHeaders = computeCorsHeaders($config);
foreach ($corsHeaders as $k => $v) {
    header("$k: $v");
}

// Preflight — only respond with 204 if CORS headers were set (origin matched)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code($corsHeaders !== [] ? 204 : 403);
    exit;
}

// ---- Routing ----

$method = $_SERVER['REQUEST_METHOD'];
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Normalize: strip trailing slash, ensure leading slash
$path = '/' . trim($path, '/');

// Health check — lightweight, unauthenticated, before main routing
if ($path === '/api/health' && ($method === 'GET' || $method === 'HEAD')) {
    try {
        $db = getDatabase($config);
        $db->query('SELECT 1');
        emitResponse(new ApiResponse(['status' => 'ok', 'timestamp' => gmdate('c')]));
    } catch (\Throwable $e) {
        error_log('Health check failed: ' . substr($e->getMessage(), 0, 200));
        emitResponse(new ApiResponse(['error' => 'Database connection failed'], 503));
    }
}

try {
    $db = getDatabase($config);

    // Parse body once for methods that need it
    $parsed = null;
    $body = null;
    if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
        $raw = readBody();
        if ($raw instanceof ApiResponse) {
            emitResponse($raw);
        }
        $parsed = parseBody($raw);
        if ($parsed instanceof ApiResponse) {
            emitResponse($parsed);
        }
        $body = $parsed['assoc'];
    }

    // Extract auth once
    $auth = extractAuth($config);

    // Match project ID for resource routes
    $projectId = null;
    if (preg_match('#^/api/projects/([A-Za-z0-9]{12})$#', $path, $matches)) {
        $projectId = $matches[1];
    }

    $response = match (true) {
        // Auth routes
        $path === '/api/auth/send-code' && $method === 'POST'
            => handleAuthSendCode($db, $config, $body),
        $path === '/api/auth/verify-code' && $method === 'POST'
            => handleAuthVerifyCode($db, $config, $body),
        $path === '/api/auth/me' && $method === 'GET'
            => handleAuthMe($db, $auth),

        // Collection routes: /api/projects
        preg_match('#^/api/projects/?$#', $path) === 1 && $method === 'POST'
            => handleCreateProject($db, $config, $auth, $parsed),
        preg_match('#^/api/projects/?$#', $path) === 1 && $method === 'GET'
            => handleListProjects($db, $auth),
        preg_match('#^/api/projects/?$#', $path) === 1
            => new ApiResponse(['error' => 'Method not allowed'], 405, ['Allow' => 'GET, POST, OPTIONS']),

        // Resource routes: /api/projects/:id
        $projectId !== null && $method === 'GET'
            => handleGetProject($db, $projectId, $auth),
        $projectId !== null && $method === 'PUT'
            => handleUpdateProject($db, $projectId, $auth, $parsed),
        $projectId !== null && $method === 'PATCH'
            => handlePatchProject($db, $projectId, $auth, $body),
        $projectId !== null && $method === 'DELETE'
            => handleDeleteProject($db, $projectId, $auth),
        $projectId !== null
            => new ApiResponse(['error' => 'Method not allowed'], 405, ['Allow' => 'GET, PUT, PATCH, DELETE, OPTIONS']),

        default => new ApiResponse(['error' => 'Not found'], 404),
    };

    emitResponse($response);
} catch (\Throwable $e) {
    error_log('API error [' . get_class($e) . ']: ' . substr($e->getMessage(), 0, 500));
    emitResponse(new ApiResponse(['error' => 'Internal server error'], 500));
}
