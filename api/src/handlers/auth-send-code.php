<?php

declare(strict_types=1);

function handleAuthSendCode(PDO $db, array $config): never
{
    $body = readParsedBody()['assoc'];

    $email = $body['email'] ?? null;
    if (!is_string($email) || $email === '') {
        sendError('email is required', 400);
    }

    $email = strtolower(trim($email));
    if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        sendError('Invalid email address', 400);
    }

    // Rate limit: max 3 codes per email per hour
    $recentCount = dbCountRecentLoginCodes($db, $email);
    if ($recentCount >= 3) {
        sendError('Too many login attempts. Please try again later.', 429);
    }

    // Generate 6-digit code
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

    // Store with 10-minute expiry
    $expiresAt = gmdate('Y-m-d H:i:s', time() + 600);
    dbCreateLoginCode($db, $email, $code, $expiresAt);

    // Send email (best-effort; don't reveal delivery failures to client)
    sendLoginCode($config, $email, $code);

    // Always return success to avoid email enumeration
    sendJson(['ok' => true]);
}
