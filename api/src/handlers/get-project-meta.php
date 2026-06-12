<?php

declare(strict_types=1);

/**
 * GET /api/projects/{id}/meta — lightweight freshness probe (P6).
 *
 * Returns the full GET's response fields minus `data`, so version checks
 * (freshness probe, GET-then-PUT save) never transfer the payload blob or
 * pay its integrity json_decode.
 */
function handleGetProjectMeta(PDO $db, string $id, array $auth): ApiResponse
{
    // Shared uniform-404 ownership/visibility gate (also used by the full GET).
    $project = requireReadableProject($db, $id, $auth, withData: false);
    if ($project instanceof ApiResponse) {
        return $project;
    }

    // Touch last_accessed_at (throttled to once per 24h at the DB level)
    dbTouchLastAccessed($db, $id);

    // Authentication flag: lets clients distinguish "not the owner" from "not
    // authenticated" — extractAuth classifies missing, malformed, expired, and
    // revoked tokens identically as kind:'none', so isOwner alone is ambiguous.
    $authenticated = ($auth['kind'] !== 'none');

    // Ownership flag: true when the requesting user owns this project.
    $isOwner = $authenticated && isProjectOwner($auth, $project);

    return new ApiResponse([
        'id'            => $project['public_id'],
        'createdAt'     => $project['created_at_iso'],
        'updatedAt'     => $project['updated_at_iso'],
        'isOwner'       => $isOwner,
        'authenticated' => $authenticated,
        'visibility'    => $project['visibility'],
        'version'       => (int) $project['version'],
    ], 200, [
        // A freshness probe must never be served stale; like the full GET
        // (since BR-5) this is always private, no-store.
        'Cache-Control' => 'private, no-store',
        // The body varies by Authorization (isOwner/authenticated), so caches
        // must key on it. Origin is included to keep the CORS layer's Vary
        // (see get-project.php for the header-replacement rationale).
        'Vary' => 'Origin, Authorization',
    ]);
}
