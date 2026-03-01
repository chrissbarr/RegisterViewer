<?php

declare(strict_types=1);

return [
    'environment' => getenv('APP_ENV') ?: 'production',

    'app_url' => 'https://www.registerviewer.com',

    'allowed_origins' => [
        'https://www.registerviewer.com',
    ],

    'jwt_secret'        => getenv('JWT_SECRET') ?: '',
    'resend_api_key'    => getenv('RESEND_API_KEY') ?: '',
    'resend_from_email' => getenv('RESEND_FROM_EMAIL') ?: 'noreply@registerviewer.com',

    'db' => [
        'host'     => getenv('DB_HOST') ?: '127.0.0.1',
        'port'     => (int) (getenv('DB_PORT') ?: 3306),
        'database' => getenv('DB_DATABASE') ?: 'register_viewer',
        'username' => getenv('DB_USERNAME') ?: '',
        'password' => getenv('DB_PASSWORD') ?: '',
        'charset'  => 'utf8mb4',
    ],
];
