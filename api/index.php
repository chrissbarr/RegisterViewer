<?php

declare(strict_types=1);

// ---- Bootstrap ----

$config = require __DIR__ . '/config.php';
$prodConfigPath = __DIR__ . '/config.production.php';
if (file_exists($prodConfigPath)) {
    $config = array_replace_recursive($config, require $prodConfigPath);
}

require __DIR__ . '/vendor/autoload.php';

require __DIR__ . '/src/api-response.php';
require __DIR__ . '/src/database.php';
require __DIR__ . '/src/cors.php';
require __DIR__ . '/src/auth.php';
require __DIR__ . '/src/jwt.php';
require __DIR__ . '/src/otp.php';
require __DIR__ . '/src/email.php';
require __DIR__ . '/src/validation.php';
require __DIR__ . '/src/request-body.php';
require __DIR__ . '/src/data-access.php';
require __DIR__ . '/src/router.php';
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
require __DIR__ . '/src/handlers/auth-logout.php';
require __DIR__ . '/database/migrate.php';

// ---- Constants ----

const SECURITY_HEADERS = [
    'X-Content-Type-Options'    => 'nosniff',
    'Referrer-Policy'           => 'no-referrer',
    'X-Frame-Options'           => 'DENY',
    'Content-Security-Policy'   => "default-src 'none'",
];

function getAuthConfigReadiness(array $config): array
{
    $checks = [
        'jwt_secret' => isset($config['jwt_secret'])
            && is_string($config['jwt_secret'])
            && strlen($config['jwt_secret']) >= 32,
        'otp_hash_secret' => isOtpHashSecretConfigured($config),
    ];

    return [
        'ready' => !in_array(false, $checks, true),
        'checks' => $checks,
    ];
}

// ---- Response helpers ----

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
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'HEAD') {
        echo $output;
    }

    // Flush response to client before shutdown functions run (PERF-05).
    // On PHP-FPM this is required; on mod_php/CLI it is a harmless no-op.
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }

    exit;
}

// ---- Auth config validation (production only) ----
// Log prominent warnings if auth-related config is missing so operators
// notice immediately in error logs rather than after user-reported failures.
// Intentionally logs on every request (no sentinel) so a misconfigured
// production environment stays noisy until fixed.

if ($config['environment'] === 'production') {
    if (empty($config['jwt_secret']) || strlen($config['jwt_secret']) < 32) {
        error_log('CONFIG WARNING: jwt_secret is missing or too short (must be >= 32 chars). '
            . 'Auth endpoints will reject all requests. '
            . 'Set jwt_secret in config.production.php; see docs/DEPLOYMENT.md Step 2.');
    }
    if (!isOtpHashSecretConfigured($config)) {
        error_log('CONFIG WARNING: otp_hash_secret is missing or too short (must be >= 32 chars). '
            . 'OTP send/verify endpoints will reject all requests. '
            . 'Set otp_hash_secret in config.production.php; see docs/DEPLOYMENT.md Step 2.');
    }
    if (empty($config['resend_api_key'])) {
        error_log('CONFIG WARNING: resend_api_key is not set. '
            . 'OTP email delivery will fail silently. '
            . 'Set resend_api_key in config.production.php; see docs/DEPLOYMENT.md Step 2.');
    }
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

// Preflight only responds with 204 if CORS headers were set (origin matched).
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code($corsHeaders !== [] ? 204 : 403);
    exit;
}

// ---- Routing context ----

$method = $_SERVER['REQUEST_METHOD'];
$path   = normalizeApiPath($_SERVER['REQUEST_URI']);

// ---- Schema readiness gate ----
// Normal API routes only run after all numbered migrations are applied and
// the schema shape required by the current code has been verified.

$db = null;
$schemaReadyResult = null;
$migrationsDir = __DIR__ . '/database/migrations';
$migrationLockFile = __DIR__ . '/database/.migrate.lock';

try {
    $db = getDatabase($config);
    $schemaReadyResult = ensureSchemaReady($db, $migrationsDir, $migrationLockFile);

    foreach ($schemaReadyResult['migrationResult']['applied'] as $file) {
        error_log("Migration applied: $file");
    }

    if (!$schemaReadyResult['ready']) {
        $status = $schemaReadyResult['status'];
        $errors = $schemaReadyResult['errors'];
        if ($errors === []) {
            $errors = $schemaReadyResult['readiness']['errors'] ?? [];
        }

        foreach (array_slice($errors, 0, 10) as $error) {
            error_log("Schema readiness failure [$status]: " . substr($error, 0, 500));
        }
        if ($errors === []) {
            error_log("Schema readiness failure [$status]: no detail available");
        }

        emitResponse(new ApiResponse([
            'error' => 'Service temporarily unavailable',
            'code' => 'schema_not_ready',
        ], 503, ['Retry-After' => '5']));
    }
} catch (\Throwable $e) {
    error_log('Schema readiness check failed: ' . substr($e->getMessage(), 0, 500));
    emitResponse(new ApiResponse([
        'error' => 'Service temporarily unavailable',
        'code' => 'schema_not_ready',
    ], 503, ['Retry-After' => '5']));
}

// ---- Routing ----

// Health check: unauthenticated, but still behind the schema readiness gate.
if ($path === '/api/health' && ($method === 'GET' || $method === 'HEAD')) {
    try {
        if ($db === null) {
            $db = getDatabase($config);
        }
        $db->query('SELECT 1');
        $readiness = $schemaReadyResult['readiness'] ?? getSchemaReadiness($db, $migrationsDir);
        $authConfigReadiness = getAuthConfigReadiness($config);
        if (!$authConfigReadiness['ready']) {
            emitResponse(new ApiResponse([
                'error' => 'Service temporarily unavailable',
                'code' => 'config_not_ready',
                'authConfig' => $authConfigReadiness['checks'],
                'timestamp' => gmdate('c'),
            ], 503));
        }
        emitResponse(new ApiResponse([
            'status' => 'ok',
            'database' => 'ok',
            'migrations' => 'ready',
            'authConfig' => $authConfigReadiness['checks'],
            'schema' => [
                'projects.version' => (bool) ($readiness['schema']['projects.version'] ?? false),
                'login_codes.code_verifier' => (bool) ($readiness['schema']['login_codes.code_verifier'] ?? false),
                'auth_rate_limits.scope' => (bool) ($readiness['schema']['auth_rate_limits.scope'] ?? false),
            ],
            'appliedMigrations' => $readiness['appliedMigrations'] ?? [],
            'pendingMigrations' => $readiness['pendingMigrations'] ?? [],
            'timestamp' => gmdate('c'),
        ]));
    } catch (\Throwable $e) {
        error_log('Health check failed: ' . substr($e->getMessage(), 0, 200));
        emitResponse(new ApiResponse(['error' => 'Database connection failed'], 503));
    }
}

// Email health check: verifies email provider is configured and reachable (DEV-04)
if ($path === '/api/health/email' && ($method === 'GET' || $method === 'HEAD')) {
    $result = checkEmailHealth($config);
    if ($result['ok']) {
        emitResponse(new ApiResponse(['status' => 'ok', 'timestamp' => gmdate('c')]));
    } else {
        error_log('Email health check failed: ' . ($result['error'] ?? 'unknown'));
        emitResponse(new ApiResponse([
            'status' => 'error',
            'error' => $result['error'] ?? 'Email service unhealthy',
            'timestamp' => gmdate('c'),
        ], 503));
    }
}

try {
    if ($db === null) {
        $db = getDatabase($config);
    }

    $response = dispatchApiRoute($db, $config, $method, $path, $_SERVER);

    emitResponse($response);
} catch (\Throwable $e) {
    error_log('API error [' . get_class($e) . ']: ' . substr($e->getMessage(), 0, 500));
    emitResponse(new ApiResponse(['error' => 'Internal server error'], 500));
}
