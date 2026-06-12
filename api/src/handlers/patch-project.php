<?php

declare(strict_types=1);

function handlePatchProject(PDO $db, string $id, array $auth, \stdClass|\Closure $bodySource): ApiResponse
{
    $existing = requireOwnership($db, $id, $auth);
    if ($existing instanceof ApiResponse) {
        return $existing;
    }

    $body = resolveParsedBody($bodySource);
    if ($body instanceof ApiResponse) {
        return $body;
    }

    if (!isset($body->visibility)) {
        return new ApiResponse(['error' => 'PATCH requires a visibility field'], 400);
    }
    if (!isValidVisibility($body->visibility)) {
        return new ApiResponse(['error' => 'visibility must be "private" or "unlisted"'], 400);
    }

    // No version check for visibility changes — they don't conflict with
    // data saves, so there's no concurrency concern. Version is only
    // checked on PUT (data updates).
    dbPatchVisibility($db, $id, $body->visibility);

    // Fetch timestamps only (lightweight query)
    $timestamps = dbGetProjectTimestamps($db, $id);

    return new ApiResponse([
        'id'        => $id,
        'updatedAt' => $timestamps['updated_at_iso'],
    ]);
}
