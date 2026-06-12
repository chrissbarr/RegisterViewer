<?php

declare(strict_types=1);

/** Refresh window: issue a new token when less than 6 hours remain on a 24-hour JWT. */
const JWT_REFRESH_WINDOW_SECONDS = 6 * 60 * 60;

function handleAuthMe(PDO $db, array $config, array $auth): ApiResponse
{
    if ($auth['kind'] !== 'jwt') {
        return new ApiResponse(['error' => 'Missing or invalid Authorization header'], 401);
    }

    $user = dbGetUserById($db, $auth['userId']);
    if ($user === null) {
        return new ApiResponse(['error' => 'User not found'], 401);
    }

    $body = [
        'user' => [
            'id'    => (int) $user['id'],
            'email' => $user['email'],
        ],
    ];

    // Sliding window refresh: issue a new token when the current one is near expiry
    $exp = $auth['exp'] ?? 0;
    if ($exp - time() < JWT_REFRESH_WINDOW_SECONDS) {
        $body['refreshedToken'] = createJwt($config, (int) $user['id'], $user['email']);
    }

    return new ApiResponse($body, 200, [
        // The success body can carry a fresh 24h bearer token (refreshedToken),
        // so it must never be stored by any cache (RFC 6749 §5.1 norm).
        'Cache-Control' => 'private, no-store',
        // The body varies by Authorization (user identity), so caches must key
        // on it. Origin is included to keep the CORS layer's Vary (see
        // get-project.php for the header-replacement rationale).
        'Vary' => 'Origin, Authorization',
    ]);
}
