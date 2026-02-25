<?php

declare(strict_types=1);

// Constants normally defined in index.php
define('MAX_PAYLOAD_SIZE', 512 * 1024);

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
require __DIR__ . '/../src/auth.php';
require __DIR__ . '/../src/database.php';
require __DIR__ . '/../src/data-access.php';
