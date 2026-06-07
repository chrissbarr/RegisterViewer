<?php

declare(strict_types=1);

function handleGetProject(PDO $db, string $id, array $auth): ApiResponse
{
    $project = dbGetProject($db, $id);
    if ($project === null) {
        return new ApiResponse(['error' => 'Project not found'], 404);
    }

    // Private projects require ownership
    if ($project['visibility'] === 'private') {
        if (!isProjectOwner($auth, $project)) {
            return new ApiResponse(['error' => 'Project not found'], 404);
        }
    }

    // Touch last_accessed_at (throttled to once per 24h at the DB level)
    dbTouchLastAccessed($db, $id);

    $cacheControl = $project['visibility'] === 'private'
        ? 'private, no-store'
        : 'private, max-age=60';

    // Validate data integrity before raw concatenation (defense-in-depth against
    // stored injection if data is ever corrupted via migration bug or direct DB edit).
    $dataJson = $project['data'];
    $decoded = json_decode($dataJson);
    if (!is_object($decoded) && !is_array($decoded)) {
        error_log("Corrupt data column for project {$project['public_id']}");
        return new ApiResponse(['error' => 'Internal server error'], 500);
    }

    // Authentication flag: lets clients distinguish "not the owner" from "not
    // authenticated" — extractAuth classifies missing, malformed, expired, and
    // revoked tokens identically as kind:'none', so isOwner alone is ambiguous.
    $authenticated = ($auth['kind'] !== 'none');

    // Ownership flag: true when the requesting user owns this project.
    $isOwner = $authenticated && isProjectOwner($auth, $project);

    // Build response manually to avoid decode/re-encode of the data JSON blob.
    // This preserves {} vs [] distinction for empty objects (e.g., registerValues: {}).
    $json = '{"id":' . json_encode($project['public_id'])
        . ',"data":' . $dataJson
        . ',"createdAt":' . json_encode($project['created_at_iso'])
        . ',"updatedAt":' . json_encode($project['updated_at_iso'])
        . ',"isOwner":' . ($isOwner ? 'true' : 'false')
        . ',"authenticated":' . ($authenticated ? 'true' : 'false')
        . ',"visibility":' . json_encode($project['visibility'])
        . ',"version":' . ((int) $project['version'])
        . '}';

    return new ApiResponse(null, 200, [
        'Cache-Control' => $cacheControl,
        // The body varies by Authorization (isOwner/authenticated), so caches
        // must key on it. emitResponse() uses PHP's default header() replace
        // semantics, so this supersedes the `Vary: Origin` emitted by the CORS
        // layer (cors.php) — Origin is included here to keep both.
        'Vary' => 'Origin, Authorization',
    ], $json);
}
