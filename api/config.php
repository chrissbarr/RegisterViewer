<?php

declare(strict_types=1);

return [
    'environment' => getenv('APP_ENV') ?: 'production',

    'app_url' => 'https://www.registerviewer.com',

    'allowed_origins' => [
        'https://www.registerviewer.com',
    ],

    'db' => [
        'host'     => getenv('DB_HOST') ?: '127.0.0.1',
        'port'     => (int) (getenv('DB_PORT') ?: 3306),
        'database' => getenv('DB_DATABASE') ?: 'register_viewer',
        'username' => getenv('DB_USERNAME') ?: '',
        'password' => getenv('DB_PASSWORD') ?: '',
        'charset'  => 'utf8mb4',
    ],
];
