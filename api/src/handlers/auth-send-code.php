<?php

declare(strict_types=1);

function handleAuthSendCode(PDO $db, array $config, array $body): ApiResponse
{
    $email = $body['email'] ?? null;
    if (!is_string($email) || $email === '') {
        return new ApiResponse(['error' => 'email is required'], 400);
    }

    $email = strtolower(trim($email));
    if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return new ApiResponse(['error' => 'Invalid email address'], 400);
    }

    // Rate limit: max 3 codes per email per hour
    $recentCount = dbCountRecentLoginCodes($db, $email);
    if ($recentCount >= 3) {
        return new ApiResponse(['error' => 'Too many login attempts. Please try again later.'], 429);
    }

    // Generate 6-digit code
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

    // Store hashed code with 10-minute expiry (SEC-04: never store plaintext OTP)
    $codeHash = hash('sha256', $code);
    $expiresAt = gmdate('Y-m-d H:i:s', time() + 600);
    dbCreateLoginCode($db, $email, $codeHash, $expiresAt);

    // Send email after response is flushed (PERF-05: avoid blocking the PHP
    // worker for up to 10s while the Resend API completes).  The shutdown
    // function runs after exit(), so the client gets the response immediately.
    register_shutdown_function(function () use ($config, $email, $code): void {
        sendLoginCode($config, $email, $code);
    });

    // Probabilistic cleanup: purge expired/used codes ~2% of the time (PERF-01)
    if (random_int(1, 50) === 1) {
        try {
            dbPurgeExpiredLoginCodes($db);
        } catch (\Throwable $e) {
            error_log('login_codes purge failed: ' . $e->getMessage());
        }
    }

    // Always return success to avoid email enumeration
    return new ApiResponse(['ok' => true]);
}
