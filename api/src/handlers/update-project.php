<?php

declare(strict_types=1);

function handleUpdateProject(PDO $db, string $id, array $auth, array $parsed): ApiResponse
{
    $existing = requireOwnership($db, $id, $auth);
    if ($existing instanceof ApiResponse) {
        return $existing;
    }

    $body = $parsed['assoc'];

    // Validate version field for optimistic concurrency.
    // When omitted (stale frontend), fall back to the server's current version
    // so the save succeeds without concurrency protection — better than a hard 400.
    // TODO: Remove fallback after one release cycle (all frontends will send version).
    $clientVersion = $body['version'] ?? null;
    if ($clientVersion === null) {
        $clientVersion = dbGetProjectVersion($db, $id);
    }
    if (!is_int($clientVersion) || $clientVersion < 1) {
        return new ApiResponse(['error' => 'version must be a positive integer'], 400);
    }

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

    $result = dbUpdateProjectVersioned(
        $db,
        $id,
        $dataJson,
        $visibility,
        $title,
        $clientVersion,
        $auth['userId'],
    );

    if (!$result['updated']) {
        // Version conflict — log for observability
        error_log(sprintf(
            'INFO 409 conflict: project=%s client_version=%d server_version=%d',
            $id, $clientVersion, $result['version']
        ));
        return new ApiResponse([
            'error'          => 'version_conflict',
            'message'        => 'Project has been modified by another session',
            'currentVersion' => $result['version'],
        ], 409);
    }

    $timestamps = dbGetProjectTimestamps($db, $id);

    return new ApiResponse([
        'id'        => $id,
        'updatedAt' => $timestamps['updated_at_iso'],
        'version'   => $result['version'],
    ]);
}
