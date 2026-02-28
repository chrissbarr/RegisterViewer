<?php

declare(strict_types=1);

function handlePatchProject(PDO $db, string $id, array $config): never
{
    requireOwnership($db, $id, $config);

    $body = readParsedBody()['assoc'];

    if (!isset($body['visibility'])) {
        sendError('PATCH requires a visibility field', 400);
    }
    if (!isValidVisibility($body['visibility'])) {
        sendError('visibility must be "private" or "unlisted"', 400);
    }

    dbPatchVisibility($db, $id, $body['visibility']);

    // Fetch timestamps only (lightweight query)
    $timestamps = dbGetProjectTimestamps($db, $id);

    sendJson([
        'id'        => $id,
        'updatedAt' => $timestamps['updated_at_iso'],
    ]);
}
