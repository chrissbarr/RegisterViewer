<?php

declare(strict_types=1);

function handleUpdateProject(PDO $db, string $id, array $config): never
{
    $existing = requireOwnership($db, $id);

    $parsed = readParsedBody();
    $body = $parsed['assoc'];

    $validation = validateProjectData($body['data'] ?? null);
    if (!$validation['valid']) {
        sendError($validation['error'], 400);
    }

    // Visibility (optional, keeps existing if not provided)
    $visibility = $existing['visibility'];
    if (isset($body['visibility'])) {
        if (!isValidVisibility($body['visibility'])) {
            sendError('visibility must be "private" or "unlisted"', 400);
        }
        $visibility = $body['visibility'];
    }

    $title = $body['data']['project']['title'] ?? null;
    if ($title !== null) {
        $title = mb_substr($title, 0, 500);
    }

    dbUpdateProject(
        $db,
        $id,
        extractDataJson($parsed['object']),
        $visibility,
        $title,
    );

    // Fetch timestamps only (lightweight query)
    $timestamps = dbGetProjectTimestamps($db, $id);

    sendJson([
        'id'        => $id,
        'updatedAt' => $timestamps['updated_at_iso'],
    ]);
}
