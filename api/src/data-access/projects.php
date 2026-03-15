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
        "SELECT public_id, visibility, data, title, user_id, version,
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
        "SELECT public_id, visibility, user_id
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
    string $visibility,
    string $data,
    ?string $title,
    int $userId,
): void {
    $stmt = $db->prepare(
        'INSERT INTO projects (public_id, visibility, data, title, user_id)
         VALUES (:public_id, :visibility, :data, :title, :user_id)'
    );
    $stmt->execute([
        'public_id'  => $publicId,
        'visibility' => $visibility,
        'data'       => $data,
        'title'      => $title,
        'user_id'    => $userId,
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
 * Update project with optimistic concurrency check.
 * Returns ['updated' => true, 'version' => int] on success,
 * or ['updated' => false, 'version' => int] on version conflict.
 *
 * Version is in the request body (not ETag/If-Match) because this API
 * uses JSON-only request/response — simpler for the SPA client.
 */
function dbUpdateProjectVersioned(
    PDO $db,
    string $publicId,
    string $data,
    string $visibility,
    ?string $title,
    int $clientVersion,
    int $userId,
): array {
    $stmt = $db->prepare(
        'UPDATE projects
         SET data = :data, visibility = :visibility, title = :title,
             version = version + 1, updated_at = NOW(), last_accessed_at = NOW()
         WHERE public_id = :public_id AND version = :version AND user_id = :user_id'
    );
    $stmt->execute([
        'data'       => $data,
        'visibility' => $visibility,
        'title'      => $title,
        'public_id'  => $publicId,
        'version'    => $clientVersion,
        'user_id'    => $userId,
    ]);

    if ($stmt->rowCount() === 0) {
        // requireOwnership() already verified ownership before this call,
        // so rowCount=0 can only mean version conflict.
        $current = dbGetProjectVersion($db, $publicId);
        return ['updated' => false, 'version' => $current];
    }

    // Version is deterministic: clientVersion + 1.
    return ['updated' => true, 'version' => $clientVersion + 1];
}

/**
 * Get the current version of a project.
 * Used in the 409 conflict response to tell the client the server's version.
 * Falls back to 1 during the deploy window before migration runs.
 */
function dbGetProjectVersion(PDO $db, string $publicId): int
{
    $stmt = $db->prepare('SELECT version FROM projects WHERE public_id = :id');
    $stmt->execute(['id' => $publicId]);
    $row = $stmt->fetch();
    return $row ? (int)($row['version'] ?? 1) : 1;
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
 * Count projects belonging to a user (by user_id).
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
 */
function dbListProjectsByUserId(PDO $db, int $userId): array
{
    $stmt = $db->prepare(
        "SELECT public_id, visibility, title, version,
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

