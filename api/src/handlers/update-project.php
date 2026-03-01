<?php

declare(strict_types=1);

function handleUpdateProject(PDO $db, string $id, array $auth, array $parsed): ApiResponse
{
    $existing = requireOwnership($db, $id, $auth);
    if ($existing instanceof ApiResponse) {
        return $existing;
    }

    $body = $parsed['assoc'];

    $validation = validateProjectData($body['data'] ?? null);
    if (!$validation['valid']) {
        return new ApiResponse(['error' => $validation['error']], 400);
    }

    // Visibility (optional, keeps existing if not provided)
    $visibility = $existing['visibility'];
    if (isset($body['visibility'])) {
        if (!isValidVisibility($body['visibility'])) {
            return new ApiResponse(['error' => 'visibility must be "private" or "unlisted"'], 400);
        }
        $visibility = $body['visibility'];
    }

    $title = $body['data']['project']['title'] ?? null;
    if ($title !== null) {
        $title = mb_substr($title, 0, 500);
    }

    $dataJson = extractDataJson($parsed['object']);
    if ($dataJson instanceof ApiResponse) {
        return $dataJson;
    }

    dbUpdateProject(
        $db,
        $id,
        $dataJson,
        $visibility,
        $title,
    );

    // Fetch timestamps only (lightweight query)
    $timestamps = dbGetProjectTimestamps($db, $id);

    return new ApiResponse([
        'id'        => $id,
        'updatedAt' => $timestamps['updated_at_iso'],
    ]);
}
