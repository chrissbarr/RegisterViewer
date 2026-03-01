<?php

declare(strict_types=1);

/**
 * Data-access functions for the projects table.
 */

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
        "SELECT public_id, visibility, title,
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

/**
 * List all projects belonging to a user, ordered by updated_at descending.
 * Same column shape as dbListProjectsByOwner for consistent API response.
 */
function dbListProjectsByUserId(PDO $db, int $userId): array
{
    $stmt = $db->prepare(
        "SELECT public_id, visibility, title,
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
