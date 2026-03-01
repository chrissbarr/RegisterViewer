<?php

declare(strict_types=1);

function handleAuthVerifyCode(PDO $db, array $config, array $body): ApiResponse
{
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

    // Optional: raw owner token for auto-linking projects (SEC-12: verify possession
    // by requiring the raw token, not just the hash — server computes hash)
    $rawOwnerToken = $body['ownerToken'] ?? null;
    $ownerTokenHash = null;
    if (is_string($rawOwnerToken) && preg_match('/^[0-9a-f]{64}$/', $rawOwnerToken)) {
        $ownerTokenHash = hash('sha256', $rawOwnerToken);
    }

    // Global rate limit: max 100 verify attempts per minute across all users (PERF-15)
    $globalAttempts = dbCountAllRecentVerifyAttempts($db, 60);
    if ($globalAttempts >= 100) {
        return new ApiResponse(['error' => 'Service temporarily unavailable. Please try again later.'], 503);
    }

    // Per-email rate limit: max 10 total verification attempts per email per 10-minute window
    $recentAttempts = dbCountRecentVerifyAttempts($db, $email);
    if ($recentAttempts >= 10) {
        return new ApiResponse(['error' => 'Too many verification attempts. Please request a new code.'], 429);
    }

    // Hash the submitted code to match stored hash (SEC-04)
    $codeHash = hash('sha256', $code);

    // Begin transaction to prevent race conditions (SEC-N01):
    // Without isolation, two concurrent requests with the same OTP can both
    // read the code as "active" before either marks it "used", resulting in
    // duplicate user creation attempts and double JWT issuance.
    $db->beginTransaction();
    try {
        // Look up active code with exclusive row lock
        $codeRow = dbGetActiveLoginCodeForUpdate($db, $email, $codeHash);
        if ($codeRow === null) {
            $db->rollBack();
            // Increment attempts on the most recent code for this email (if any),
            // so that failed guesses count against the per-code and global rate limits
            dbIncrementMostRecentLoginCodeAttempts($db, $email);
            return new ApiResponse(['error' => 'Invalid or expired code'], 401);
        }

        // Increment attempts (even on success, to track usage)
        dbIncrementLoginCodeAttempts($db, (int) $codeRow['id']);

        // Mark code as used
        dbMarkLoginCodeUsed($db, (int) $codeRow['id']);

        // Find or create user
        $user = dbFindOrCreateUser($db, $email);
        $userId = (int) $user['id'];

        // Auto-link anonymous projects to this user account
        if ($ownerTokenHash !== null) {
            dbLinkProjectsByOwnerToken($db, $ownerTokenHash, $userId);
        }

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
