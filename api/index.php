<?php

declare(strict_types=1);

// ---- Bootstrap ----

$config = require __DIR__ . '/config.php';
$prodConfigPath = __DIR__ . '/config.production.php';
if (file_exists($prodConfigPath)) {
    $config = array_replace_recursive($config, require $prodConfigPath);
}

require __DIR__ . '/src/database.php';
require __DIR__ . '/src/cors.php';
require __DIR__ . '/src/auth.php';
require __DIR__ . '/src/validation.php';
require __DIR__ . '/src/data-access.php';
require __DIR__ . '/src/id.php';
require __DIR__ . '/src/handlers/create-project.php';
require __DIR__ . '/src/handlers/get-project.php';
require __DIR__ . '/src/handlers/update-project.php';
require __DIR__ . '/src/handlers/patch-project.php';
require __DIR__ . '/src/handlers/delete-project.php';
require __DIR__ . '/src/handlers/list-projects.php';

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

// ---- Body reading ----

function readBody(): string
{
    static $rawBody = null;
    if ($rawBody !== null) {
        return $rawBody;
    }

    // Check Content-Length header first (fast path)
    $contentLength = $_SERVER['HTTP_CONTENT_LENGTH'] ?? $_SERVER['CONTENT_LENGTH'] ?? null;
    if ($contentLength !== null && (int) $contentLength > LIMITS['MAX_PAYLOAD_SIZE']) {
        sendError('Request body must be at most ' . LIMITS['MAX_PAYLOAD_SIZE'] . ' bytes', 400);
    }

    $rawBody = file_get_contents('php://input', false, null, 0, LIMITS['MAX_PAYLOAD_SIZE'] + 1);
    if ($rawBody === false) {
        $rawBody = '';
    }
    if (strlen($rawBody) > LIMITS['MAX_PAYLOAD_SIZE']) {
        sendError('Request body must be at most ' . LIMITS['MAX_PAYLOAD_SIZE'] . ' bytes', 400);
    }

    return $rawBody;
}

/**
 * Parse the request body as JSON, returning both associative-array and stdClass views.
 *
 * The body is parsed once as stdClass (to preserve the {} vs [] distinction,
 * since json_decode with assoc=true turns {} into [], losing the difference).
 * The assoc view is derived by recursively converting the stdClass tree,
 * avoiding a second json_decode call.
 *
 * The assoc view is used for validation and reading scalar fields.
 * The object view is used for faithful JSON storage.
 *
 * @return array{assoc: array, object: object}
 */
function readParsedBody(): array
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $text = readBody();
    if ($text === '') {
        sendError('Invalid JSON body', 400);
    }

    $object = json_decode($text);
    if (json_last_error() !== JSON_ERROR_NONE || !is_object($object)) {
        sendError('Invalid JSON body', 400);
    }

    $assoc = objectToAssoc($object);

    $cached = ['assoc' => $assoc, 'object' => $object];
    return $cached;
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
 */
function extractDataJson(object $parsedObject): string
{
    if (!property_exists($parsedObject, 'data')) {
        sendError('Invalid JSON body', 400);
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
        sendJson(['status' => 'ok', 'timestamp' => gmdate('c')]);
    } catch (\Throwable $e) {
        error_log('Health check failed: ' . substr($e->getMessage(), 0, 200));
        sendError('Database connection failed', 503);
    }
}

try {
    $db = getDatabase($config);

    // Collection routes: /api/projects
    if (preg_match('#^/api/projects/?$#', $path)) {
        match ($method) {
            'POST' => handleCreateProject($db, $config),
            'GET'  => handleListProjects($db),
            default => sendError('Method not allowed', 405, ['Allow' => 'GET, POST, OPTIONS']),
        };
    // Resource routes: /api/projects/:id (12-char alphanumeric)
    } elseif (preg_match('#^/api/projects/([A-Za-z0-9]{12})$#', $path, $matches)) {
        $id = $matches[1];

        match ($method) {
            'GET'    => handleGetProject($db, $id),
            'PUT'    => handleUpdateProject($db, $id, $config),
            'PATCH'  => handlePatchProject($db, $id),
            'DELETE' => handleDeleteProject($db, $id),
            default  => sendError('Method not allowed', 405, ['Allow' => 'GET, PUT, PATCH, DELETE, OPTIONS']),
        };
    } else {
        sendError('Not found', 404);
    }
} catch (\Throwable $e) {
    error_log('API error [' . get_class($e) . ']: ' . substr($e->getMessage(), 0, 500));
    sendError('Internal server error', 500);
}
