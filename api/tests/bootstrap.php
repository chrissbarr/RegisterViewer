<?php

declare(strict_types=1);

// Constants normally defined in index.php
define('SECURITY_HEADERS', [
    'X-Content-Type-Options'  => 'nosniff',
    'Referrer-Policy'         => 'no-referrer',
    'X-Frame-Options'         => 'DENY',
    'Content-Security-Policy' => "default-src 'none'",
]);

// Default $_SERVER values for functions that read from it
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/';

// Require source files (order matters: validation.php defines LIMITS constant)
require __DIR__ . '/../src/validation.php';
require __DIR__ . '/../src/id.php';
require __DIR__ . '/../src/cors.php';
require __DIR__ . '/../src/jwt.php';
require __DIR__ . '/../src/email.php';
require __DIR__ . '/../src/auth.php';
require __DIR__ . '/../src/database.php';
require __DIR__ . '/../src/data-access.php';
require __DIR__ . '/../src/api-response.php';

// Handler files (needed for handler-level integration tests)
require __DIR__ . '/../src/handlers/auth-send-code.php';
require __DIR__ . '/../src/handlers/auth-verify-code.php';
require __DIR__ . '/../src/handlers/auth-me.php';
require __DIR__ . '/../src/handlers/create-project.php';
require __DIR__ . '/../src/handlers/get-project.php';
require __DIR__ . '/../src/handlers/update-project.php';
require __DIR__ . '/../src/handlers/patch-project.php';
require __DIR__ . '/../src/handlers/delete-project.php';
require __DIR__ . '/../src/handlers/list-projects.php';
require __DIR__ . '/../database/migrate.php';
