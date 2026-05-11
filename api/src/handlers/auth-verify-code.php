<?php

declare(strict_types=1);

function handleAuthVerifyCode(PDO $db, array $config, array $body, ?array $server = null): ApiResponse
{
    $server ??= $_SERVER;

    // Validate email
    $email = validateAndNormalizeEmail($body);
    if ($email instanceof ApiResponse) {
        return $email;
    }

    // Validate code
    $code = $body['code'] ?? null;
    if (!is_string($code) || !preg_match('/^\d{6}$/', $code)) {
        return new ApiResponse(['error' => 'code must be a 6-digit string'], 400);
    }

    $clientIp = authRateLimitClientIp($server);

    if (random_int(1, 50) === 1) {
        try {
            dbPurgeExpiredAuthRateLimitBuckets($db);
        } catch (\Throwable $e) {
            error_log('auth_rate_limits purge failed: ' . $e->getMessage());
        }
    }

    $globalLimit = dbConsumeAuthRateLimit(
        $db,
        'verify.global',
        'global',
        AUTH_VERIFY_GLOBAL_LIMIT,
        AUTH_VERIFY_GLOBAL_WINDOW_SECONDS,
    );
    if (!$globalLimit['allowed']) {
        return new ApiResponse(['error' => 'Service temporarily unavailable. Please try again later.'], 503);
    }

    $ipLimit = dbConsumeAuthRateLimit(
        $db,
        'verify.ip',
        $clientIp,
        AUTH_VERIFY_IP_LIMIT,
        AUTH_VERIFY_IP_WINDOW_SECONDS,
    );
    if (!$ipLimit['allowed']) {
        return new ApiResponse(['error' => 'Too many verification attempts. Please try again later.'], 429);
    }

    $emailLimit = dbConsumeAuthRateLimit(
        $db,
        'verify.email',
        $email,
        AUTH_VERIFY_EMAIL_LIMIT,
        AUTH_VERIFY_EMAIL_WINDOW_SECONDS,
    );
    if (!$emailLimit['allowed']) {
        return new ApiResponse(['error' => 'Too many verification attempts. Please try again later.'], 429);
    }

    // Hash the submitted code to match stored hash (SEC-04)
    $codeHash = hash('sha256', $code);

    // Begin transaction to prevent race conditions (SEC-N01):
    // Without isolation, two concurrent requests with the same OTP can both
    // read the code as "active" before either marks it "used", resulting in
    // duplicate user creation attempts and double JWT issuance.
    $db->beginTransaction();
    try {
        // Lock the latest issued code for this email. Newer codes supersede
        // older ones even after the newest code is used or locked.
        $codeRow = dbGetLatestLoginCodeForUpdate($db, $email);
        if ($codeRow === null) {
            $db->commit();
            return new ApiResponse(['error' => 'Invalid or expired code'], 401);
        }
        if ((int) $codeRow['used'] === 1 || strtotime((string) $codeRow['expires_at']) <= time()) {
            $db->commit();
            return new ApiResponse(['error' => 'Invalid or expired code'], 401);
        }
        if ((int) $codeRow['attempts'] >= OTP_MAX_ATTEMPTS) {
            $db->commit();
            return new ApiResponse(['error' => 'Invalid or expired code'], 401);
        }

        dbIncrementLoginCodeAttempts($db, (int) $codeRow['id']);

        if (!hash_equals((string) $codeRow['code'], $codeHash)) {
            $db->commit();
            return new ApiResponse(['error' => 'Invalid or expired code'], 401);
        }

        // Mark code as used
        dbMarkLoginCodeUsed($db, (int) $codeRow['id']);

        // Find or create user
        $user = dbFindOrCreateUser($db, $email);
        $userId = (int) $user['id'];

        $db->commit();
    } catch (\Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    // Generate JWT (outside transaction — no DB writes needed)
    $token = createJwt($config, $userId, $email);

    return new ApiResponse([
        'token' => $token,
        'user'  => [
            'id'    => $userId,
            'email' => $email,
        ],
    ]);
}
