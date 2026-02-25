<?php

declare(strict_types=1);

function handleGetProject(PDO $db, string $id): never
{
    $project = dbGetProject($db, $id);
    if ($project === null) {
        sendError('Project not found', 404);
    }

    // Private projects require ownership
    if ($project['visibility'] === 'private') {
        $tokenHash = extractTokenHash();
        if ($tokenHash === null || !isOwner($tokenHash, $project)) {
            sendError('Project not found', 404);
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
        sendError('Internal server error', 500);
    }

    // Build response manually to avoid decode/re-encode of the data JSON blob.
    // This preserves {} vs [] distinction for empty objects (e.g., registerValues: {}).
    $json = '{"id":' . json_encode($project['public_id'])
        . ',"data":' . $dataJson
        . ',"createdAt":' . json_encode($project['created_at_iso'])
        . ',"updatedAt":' . json_encode($project['updated_at_iso'])
        . '}';

    sendRawJson($json, 200, [
        'Cache-Control' => $cacheControl,
    ]);
}
