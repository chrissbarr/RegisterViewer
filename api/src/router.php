<?php

declare(strict_types=1);

const API_BODY_NONE = 'none';
const API_BODY_JSON = 'json';

/**
 * Normalize a request URI to the API path shape used by route matching.
 */
function normalizeApiPath(string $requestUri): string
{
    $path = parse_url($requestUri, PHP_URL_PATH);
    if (!is_string($path) || $path === '') {
        $path = '/';
    }
    return '/' . trim($path, '/');
}

/**
 * @return array{name: string, bodyPolicy: string, projectId: ?string, response: ?ApiResponse}
 */
function apiRoute(
    string $name,
    string $bodyPolicy = API_BODY_NONE,
    ?string $projectId = null,
    ?ApiResponse $response = null,
): array {
    return [
        'name'       => $name,
        'bodyPolicy' => $bodyPolicy,
        'projectId'  => $projectId,
        'response'   => $response,
    ];
}

/**
 * Resolve the route and its request-body policy before reading php://input.
 *
 * @return array{name: string, bodyPolicy: string, projectId: ?string, response: ?ApiResponse}
 */
function resolveApiRoute(string $method, string $path): array
{
    return match (true) {
        $path === '/api/auth/send-code' && $method === 'POST'
            => apiRoute('auth.send-code', API_BODY_JSON),
        $path === '/api/auth/verify-code' && $method === 'POST'
            => apiRoute('auth.verify-code', API_BODY_JSON),
        $path === '/api/auth/me' && $method === 'GET'
            => apiRoute('auth.me'),
        $path === '/api/auth/logout' && $method === 'POST'
            => apiRoute('auth.logout'),

        preg_match('#^/api/projects/?$#', $path) === 1 && $method === 'POST'
            => apiRoute('projects.create', API_BODY_JSON),
        preg_match('#^/api/projects/?$#', $path) === 1 && $method === 'GET'
            => apiRoute('projects.list'),
        preg_match('#^/api/projects/?$#', $path) === 1
            => apiRoute('error', API_BODY_NONE, null, new ApiResponse(
                ['error' => 'Method not allowed'],
                405,
                ['Allow' => 'GET, POST, OPTIONS']
            )),

        preg_match('#^/api/projects/([A-Za-z0-9]{12})$#', $path, $matches) === 1 && $method === 'GET'
            => apiRoute('projects.get', API_BODY_NONE, $matches[1]),
        preg_match('#^/api/projects/([A-Za-z0-9]{12})$#', $path, $matches) === 1 && $method === 'PUT'
            => apiRoute('projects.update', API_BODY_JSON, $matches[1]),
        preg_match('#^/api/projects/([A-Za-z0-9]{12})$#', $path, $matches) === 1 && $method === 'PATCH'
            => apiRoute('projects.patch', API_BODY_JSON, $matches[1]),
        preg_match('#^/api/projects/([A-Za-z0-9]{12})$#', $path, $matches) === 1 && $method === 'DELETE'
            => apiRoute('projects.delete', API_BODY_NONE, $matches[1]),
        preg_match('#^/api/projects/([A-Za-z0-9]{12})$#', $path) === 1
            => apiRoute('error', API_BODY_NONE, null, new ApiResponse(
                ['error' => 'Method not allowed'],
                405,
                ['Allow' => 'GET, PUT, PATCH, DELETE, OPTIONS']
            )),

        default => apiRoute('error', API_BODY_NONE, null, new ApiResponse(['error' => 'Not found'], 404)),
    };
}

/**
 * Dispatch a resolved API request. The body reader is intentionally lazy so
 * routes without JSON bodies never read or validate php://input. Protected
 * JSON routes resolve the body only after their auth/ownership gates pass.
 */
function dispatchApiRoute(
    PDO $db,
    array $config,
    string $method,
    string $path,
    array $server,
    ?callable $bodyReader = null,
): ApiResponse {
    $route = resolveApiRoute($method, $path);
    if ($route['response'] instanceof ApiResponse) {
        return $route['response'];
    }

    $bodyLoaded = false;
    $parsedBody = null;
    $getParsedBody = function () use (&$bodyLoaded, &$parsedBody, $server, $bodyReader, $route): array|ApiResponse {
        if ($route['bodyPolicy'] !== API_BODY_JSON) {
            return new ApiResponse(['error' => 'Internal server error'], 500);
        }
        if (!$bodyLoaded) {
            $parsedBody = readJsonObjectBody($server, $bodyReader);
            $bodyLoaded = true;
        }
        return $parsedBody;
    };

    $auth = extractAuth($config, $db);
    $projectId = $route['projectId'];

    return match ($route['name']) {
        'auth.send-code' => dispatchJsonBody($getParsedBody, fn (array $parsed): ApiResponse =>
            handleAuthSendCode($db, $config, $parsed['assoc'])
        ),
        'auth.verify-code' => dispatchJsonBody($getParsedBody, fn (array $parsed): ApiResponse =>
            handleAuthVerifyCode($db, $config, $parsed['assoc'])
        ),
        'auth.me' => handleAuthMe($db, $config, $auth),
        'auth.logout' => handleAuthLogout($db, $auth),

        'projects.create' => handleCreateProject($db, $config, $auth, $getParsedBody),
        'projects.list' => handleListProjects($db, $auth),
        'projects.get' => handleGetProject($db, (string) $projectId, $auth),
        'projects.update' => handleUpdateProject($db, (string) $projectId, $auth, $getParsedBody),
        'projects.patch' => handlePatchProject($db, (string) $projectId, $auth, $getParsedBody),
        'projects.delete' => handleDeleteProject($db, (string) $projectId, $auth),

        default => new ApiResponse(['error' => 'Not found'], 404),
    };
}

/**
 * Resolve a required JSON body for unauthenticated JSON endpoints.
 */
function dispatchJsonBody(callable $getParsedBody, callable $handler): ApiResponse
{
    $parsed = $getParsedBody();
    if ($parsed instanceof ApiResponse) {
        return $parsed;
    }
    return $handler($parsed);
}
