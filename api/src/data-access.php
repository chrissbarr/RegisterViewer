<?php

declare(strict_types=1);

/**
 * Get a project by its public_id (full row including data).
 * Returns timestamps in ISO 8601 format for API compatibility.
 */
function dbGetProject(PDO $db, string $id): ?array
{
    $stmt = $db->prepare(
        "SELECT public_id, owner_token_hash, visibility, data, title, user_id,
                DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_iso,
                DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_iso,
                DATE_FORMAT(last_accessed_at, '%Y-%m-%dT%H:%i:%sZ') AS last_accessed_at_iso
         FROM projects
         WHERE public_id = :id
         LIMIT 1"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Get a project for auth/ownership verification only (no data column).
 */
function dbGetProjectForAuth(PDO $db, string $id): ?array
{
    $stmt = $db->prepare(
        "SELECT public_id, owner_token_hash, visibility, user_id
         FROM projects
         WHERE public_id = :id
         LIMIT 1"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Get timestamps for a project (used after write operations).
 */
function dbGetProjectTimestamps(PDO $db, string $id): ?array
{
    $stmt = $db->prepare(
        "SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_iso,
                DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_iso
         FROM projects
         WHERE public_id = :id
         LIMIT 1"
    );
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Insert a new project.
 */
function dbCreateProject(
    PDO $db,
    string $publicId,
    string $ownerTokenHash,
    string $visibility,
    string $data,
    ?string $title,
    ?int $userId = null,
): void {
    $stmt = $db->prepare(
        'INSERT INTO projects (public_id, owner_token_hash, visibility, data, title, user_id)
         VALUES (:public_id, :owner_token_hash, :visibility, :data, :title, :user_id)'
    );
    $stmt->execute([
        'public_id'        => $publicId,
        'owner_token_hash' => $ownerTokenHash,
        'visibility'       => $visibility,
        'data'             => $data,
        'title'            => $title,
        'user_id'          => $userId,
    ]);
}

/**
 * Full update of a project's data, visibility, and title.
 * Explicitly sets updated_at and last_accessed_at to match previous API behavior.
 */
function dbUpdateProject(
    PDO $db,
    string $publicId,
    string $data,
    string $visibility,
    ?string $title,
): void {
    $stmt = $db->prepare(
        'UPDATE projects
         SET data = :data, visibility = :visibility, title = :title,
             updated_at = NOW(), last_accessed_at = NOW()
         WHERE public_id = :public_id'
    );
    $stmt->execute([
        'data'       => $data,
        'visibility' => $visibility,
        'title'      => $title,
        'public_id'  => $publicId,
    ]);
}

/**
 * Patch only the visibility of a project.
 * Explicitly sets updated_at to match previous API behavior.
 */
function dbPatchVisibility(PDO $db, string $publicId, string $visibility): void
{
    $stmt = $db->prepare(
        'UPDATE projects SET visibility = :visibility, updated_at = NOW()
         WHERE public_id = :public_id'
    );
    $stmt->execute([
        'visibility' => $visibility,
        'public_id'  => $publicId,
    ]);
}

/**
 * Delete a project by public_id.
 */
function dbDeleteProject(PDO $db, string $publicId): void
{
    $stmt = $db->prepare('DELETE FROM projects WHERE public_id = :public_id');
    $stmt->execute(['public_id' => $publicId]);
}

/**
 * List all projects owned by a given token hash, ordered by updated_at descending.
 * Returns summary rows with ISO-formatted timestamps. Limited to 500 results.
 */
function dbListProjectsByOwner(PDO $db, string $tokenHash): array
{
    $stmt = $db->prepare(
        "SELECT public_id, visibility,
                DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_iso,
                DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_iso
         FROM projects
         WHERE owner_token_hash = :token_hash
         ORDER BY updated_at DESC
         LIMIT 500"
    );
    $stmt->execute(['token_hash' => $tokenHash]);
    return $stmt->fetchAll();
}

/**
 * Count projects owned by a given token hash.
 */
function dbCountProjectsByOwner(PDO $db, string $tokenHash): int
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM projects WHERE owner_token_hash = :token_hash'
    );
    $stmt->execute(['token_hash' => $tokenHash]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count projects belonging to a user (by user_id).
 * Used alongside dbCountProjectsByOwner to enforce per-user project limits
 * for JWT-authenticated users who may have multiple owner token hashes.
 */
function dbCountProjectsByUserId(PDO $db, int $userId): int
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM projects WHERE user_id = :user_id'
    );
    $stmt->execute(['user_id' => $userId]);
    return (int) $stmt->fetchColumn();
}

/**
 * Touch last_accessed_at if it is more than 24 hours stale.
 * The WHERE clause makes this a no-op if recently accessed.
 */
function dbTouchLastAccessed(PDO $db, string $publicId): void
{
    $stmt = $db->prepare(
        'UPDATE projects
         SET last_accessed_at = NOW()
         WHERE public_id = :public_id
           AND last_accessed_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)'
    );
    $stmt->execute(['public_id' => $publicId]);
}

// ---- User & Auth queries ----

/**
 * Find a user by email.
 */
function dbGetUserByEmail(PDO $db, string $email): ?array
{
    $stmt = $db->prepare('SELECT id, email FROM users WHERE email = :email LIMIT 1');
    $stmt->execute(['email' => $email]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Find a user by ID.
 */
function dbGetUserById(PDO $db, int $id): ?array
{
    $stmt = $db->prepare('SELECT id, email FROM users WHERE id = :id LIMIT 1');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Create a new user. Returns the auto-increment ID.
 */
function dbCreateUser(PDO $db, string $email): int
{
    $stmt = $db->prepare('INSERT INTO users (email) VALUES (:email)');
    $stmt->execute(['email' => $email]);
    return (int) $db->lastInsertId();
}

/**
 * Store a login OTP code.
 *
 * @param string $code SHA-256 hex digest of the OTP code (64 chars)
 * @param string|null $ipAddress Client IP address for rate limiting (PERF-15)
 */
function dbCreateLoginCode(PDO $db, string $email, string $code, string $expiresAt, ?string $ipAddress = null): void
{
    $stmt = $db->prepare(
        'INSERT INTO login_codes (email, code, expires_at, ip_address)
         VALUES (:email, :code, :expires_at, :ip_address)'
    );
    $stmt->execute([
        'email'      => $email,
        'code'       => $code,
        'expires_at' => $expiresAt,
        'ip_address' => $ipAddress,
    ]);
}

/**
 * Get an active (unused, unexpired, under attempt limit) login code.
 *
 * @param string $code SHA-256 hex digest of the OTP code to match (64 chars)
 */
function dbGetActiveLoginCode(PDO $db, string $email, string $code): ?array
{
    $stmt = $db->prepare(
        'SELECT id, email, code, expires_at, attempts
         FROM login_codes
         WHERE email = :email AND code = :code AND used = 0
           AND expires_at > NOW() AND attempts < 5
         ORDER BY created_at DESC
         LIMIT 1'
    );
    $stmt->execute(['email' => $email, 'code' => $code]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Increment the attempt counter on a login code.
 */
function dbIncrementLoginCodeAttempts(PDO $db, int $id): void
{
    $stmt = $db->prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = :id');
    $stmt->execute(['id' => $id]);
}

/**
 * Increment attempts on the most recent active code for an email.
 * Used to track failed guesses (wrong code) against the global rate limit.
 */
function dbIncrementMostRecentLoginCodeAttempts(PDO $db, string $email): void
{
    $stmt = $db->prepare(
        'UPDATE login_codes SET attempts = attempts + 1
         WHERE email = :email AND used = 0 AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1'
    );
    $stmt->execute(['email' => $email]);
}

/**
 * Mark a login code as used.
 */
function dbMarkLoginCodeUsed(PDO $db, int $id): void
{
    $stmt = $db->prepare('UPDATE login_codes SET used = 1 WHERE id = :id');
    $stmt->execute(['id' => $id]);
}

/**
 * Count login codes sent to an email in the last hour (rate limiting).
 */
function dbCountRecentLoginCodes(PDO $db, string $email): int
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_codes
         WHERE email = :email AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
    );
    $stmt->execute(['email' => $email]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count total verification attempts for an email in the last 10 minutes.
 * Sums the attempts column across all recent codes (not just a single code).
 * Used as a global rate limit on the verify endpoint.
 */
function dbCountRecentVerifyAttempts(PDO $db, string $email): int
{
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(attempts), 0) FROM login_codes
         WHERE email = :email AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)'
    );
    $stmt->execute(['email' => $email]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count total login codes sent globally within the given interval.
 * Used as a global rate limit to prevent mass OTP abuse (PERF-15).
 */
function dbCountAllRecentLoginCodes(PDO $db, int $intervalSeconds = 60): int
{
    $cutoff = gmdate('Y-m-d H:i:s', time() - $intervalSeconds);
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_codes WHERE created_at > :cutoff'
    );
    $stmt->execute(['cutoff' => $cutoff]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count login codes sent from a specific IP within the given interval.
 * Used for per-IP rate limiting to prevent spam relay abuse (PERF-15).
 */
function dbCountRecentLoginCodesByIp(PDO $db, string $ipAddress, int $intervalSeconds = 900): int
{
    $cutoff = gmdate('Y-m-d H:i:s', time() - $intervalSeconds);
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_codes
         WHERE ip_address = :ip AND created_at > :cutoff'
    );
    $stmt->execute(['ip' => $ipAddress, 'cutoff' => $cutoff]);
    return (int) $stmt->fetchColumn();
}

/**
 * Count total verification attempts globally within the given interval.
 * Sums the attempts column across all recent codes.
 * Used as a global rate limit on the verify endpoint (PERF-15).
 */
function dbCountAllRecentVerifyAttempts(PDO $db, int $intervalSeconds = 60): int
{
    $cutoff = gmdate('Y-m-d H:i:s', time() - $intervalSeconds);
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(attempts), 0) FROM login_codes WHERE created_at > :cutoff'
    );
    $stmt->execute(['cutoff' => $cutoff]);
    return (int) $stmt->fetchColumn();
}

/**
 * Purge expired and used login codes older than 24 hours.
 * Keeps the login_codes table bounded by removing rows that are no longer
 * useful for verification or rate-limit accounting. Uses LIMIT to avoid
 * holding a table lock for too long on large backlogs.
 *
 * @return int Number of rows deleted
 */
function dbPurgeExpiredLoginCodes(PDO $db): int
{
    $stmt = $db->prepare(
        'DELETE FROM login_codes
         WHERE (used = 1 OR expires_at < NOW())
           AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
         LIMIT 10000'
    );
    $stmt->execute();
    return $stmt->rowCount();
}

/**
 * Link all anonymous projects owned by a token hash to a user account.
 * Only links projects that don't already have a user_id.
 * Returns the number of projects linked.
 */
function dbLinkProjectsByOwnerToken(PDO $db, string $ownerTokenHash, int $userId): int
{
    $stmt = $db->prepare(
        'UPDATE projects SET user_id = :user_id
         WHERE owner_token_hash = :hash AND user_id IS NULL'
    );
    $stmt->execute([
        'user_id' => $userId,
        'hash'    => $ownerTokenHash,
    ]);
    return $stmt->rowCount();
}

// ---- Token revocation queries ----

/**
 * Check if a JWT has been revoked by its jti claim.
 */
function dbIsTokenRevoked(PDO $db, string $jti): bool
{
    $stmt = $db->prepare('SELECT 1 FROM revoked_tokens WHERE jti = :jti LIMIT 1');
    $stmt->execute(['jti' => $jti]);
    return (bool) $stmt->fetchColumn();
}

/**
 * Revoke a JWT by storing its jti. The expires_at column allows cleanup.
 */
function dbRevokeToken(PDO $db, string $jti, string $expiresAt): void
{
    $stmt = $db->prepare(
        'INSERT IGNORE INTO revoked_tokens (jti, expires_at) VALUES (:jti, :expires_at)'
    );
    $stmt->execute(['jti' => $jti, 'expires_at' => $expiresAt]);
}

/**
 * Delete revoked tokens whose original JWT has already expired.
 * Safe to call on every logout — bounded by the number of expired entries.
 */
function dbCleanupRevokedTokens(PDO $db): void
{
    $db->exec('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
}

/**
 * List all projects belonging to a user, ordered by updated_at descending.
 * Same column shape as dbListProjectsByOwner for consistent API response.
 */
function dbListProjectsByUserId(PDO $db, int $userId): array
{
    $stmt = $db->prepare(
        "SELECT public_id, visibility,
                DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at_iso,
                DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at_iso
         FROM projects
         WHERE user_id = :user_id
         ORDER BY updated_at DESC
         LIMIT 500"
    );
    $stmt->execute(['user_id' => $userId]);
    return $stmt->fetchAll();
}
