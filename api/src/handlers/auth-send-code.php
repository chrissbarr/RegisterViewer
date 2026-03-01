<?php

declare(strict_types=1);

function handleAuthSendCode(PDO $db, array $config, array $body): ApiResponse
{
    $email = validateAndNormalizeEmail($body);
    if ($email instanceof ApiResponse) {
        return $email;
    }

    // Global rate limit: max 30 OTP sends per minute across all users (PERF-15)
    $globalCount = dbCountAllRecentLoginCodes($db, 60);
    if ($globalCount >= 30) {
        return new ApiResponse(['error' => 'Service temporarily unavailable. Please try again later.'], 503);
    }

    // IP rate limit: max 5 OTP sends per IP per 15 minutes (PERF-15)
    // Note: on cPanel (no reverse proxy) REMOTE_ADDR is the real client IP.
    // Behind a reverse proxy, consider using X-Forwarded-For instead.
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $ipCount = dbCountRecentLoginCodesByIp($db, $clientIp, 900);
    if ($ipCount >= 5) {
        return new ApiResponse(['error' => 'Too many requests. Please try again later.'], 429);
    }

    // Per-email rate limit: max 3 codes per email per hour
    $recentCount = dbCountRecentLoginCodes($db, $email);
    if ($recentCount >= OTP_RATE_LIMIT_PER_HOUR) {
        return new ApiResponse(['error' => 'Too many login attempts. Please try again later.'], 429);
    }

    // Generate 6-digit code
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

    // Store hashed code with 10-minute expiry (SEC-04: never store plaintext OTP)
    $codeHash = hash('sha256', $code);
    $expiresAt = gmdate('Y-m-d H:i:s', time() + OTP_EXPIRY_SECONDS);
    dbCreateLoginCode($db, $email, $codeHash, $expiresAt, $clientIp);

    // In development, log the OTP code so developers can complete the login
    // flow without a real Resend API key.
    if (($config['environment'] ?? 'production') === 'development') {
        error_log("DEV OTP for $email: $code");
    }

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
