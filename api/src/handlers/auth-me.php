<?php

declare(strict_types=1);

function handleAuthMe(PDO $db, array $auth): ApiResponse
{
    if ($auth['kind'] !== 'jwt') {
        return new ApiResponse(['error' => 'Missing or invalid Authorization header'], 401);
    }

    $user = dbGetUserById($db, $auth['userId']);
    if ($user === null) {
        return new ApiResponse(['error' => 'User not found'], 401);
    }

    return new ApiResponse([
        'user' => [
            'id'    => (int) $user['id'],
            'email' => $user['email'],
        ],
    ]);
}
