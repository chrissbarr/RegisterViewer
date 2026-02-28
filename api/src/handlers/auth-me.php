<?php

declare(strict_types=1);

function handleAuthMe(PDO $db, array $config): never
{
    $auth = extractAuth($config);
    if ($auth['kind'] !== 'jwt') {
        sendError('Missing or invalid Authorization header', 401);
    }

    $user = dbGetUserById($db, $auth['userId']);
    if ($user === null) {
        sendError('User not found', 401);
    }

    sendJson([
        'user' => [
            'id'    => (int) $user['id'],
            'email' => $user['email'],
        ],
    ]);
}
