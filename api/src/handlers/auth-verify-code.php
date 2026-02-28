<?php

declare(strict_types=1);

function handleAuthVerifyCode(PDO $db, array $config): never
{
    $body = readParsedBody()['assoc'];

    // Validate email
    $email = $body['email'] ?? null;
    if (!is_string($email) || $email === '') {
        sendError('email is required', 400);
    }
    $email = strtolower(trim($email));
    if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        sendError('Invalid email address', 400);
    }

    // Validate code
    $code = $body['code'] ?? null;
    if (!is_string($code) || !preg_match('/^\d{6}$/', $code)) {
        sendError('code must be a 6-digit string', 400);
    }

    // Optional: owner token hash for auto-linking projects
    $ownerTokenHash = $body['ownerTokenHash'] ?? null;
    if ($ownerTokenHash !== null) {
        if (!is_string($ownerTokenHash) || !preg_match('/^[0-9a-f]{64}$/', $ownerTokenHash)) {
            $ownerTokenHash = null; // silently ignore invalid hash
        }
    }

    // Global rate limit: max 10 total verification attempts per email per 10-minute window
    $recentAttempts = dbCountRecentVerifyAttempts($db, $email);
    if ($recentAttempts >= 10) {
        sendError('Too many verification attempts. Please request a new code.', 429);
    }

    // Look up active code
    $codeRow = dbGetActiveLoginCode($db, $email, $code);
    if ($codeRow === null) {
        // Increment attempts on the most recent code for this email (if any),
        // so that failed guesses count against the per-code and global rate limits
        dbIncrementMostRecentLoginCodeAttempts($db, $email);
        sendError('Invalid or expired code', 401);
    }

    // Increment attempts (even on success, to track usage)
    dbIncrementLoginCodeAttempts($db, (int) $codeRow['id']);

    // Mark code as used
    dbMarkLoginCodeUsed($db, (int) $codeRow['id']);

    // Find or create user
    $user = dbGetUserByEmail($db, $email);
    if ($user === null) {
        $userId = dbCreateUser($db, $email);
        $user = ['id' => $userId, 'email' => $email];
    }
    $userId = (int) $user['id'];

    // Auto-link anonymous projects to this user account
    if ($ownerTokenHash !== null) {
        dbLinkProjectsByOwnerToken($db, $ownerTokenHash, $userId);
    }

    // Generate JWT
    $token = createJwt($config, $userId, $email);

    sendJson([
        'token' => $token,
        'user'  => [
            'id'    => $userId,
            'email' => $email,
        ],
    ]);
}
