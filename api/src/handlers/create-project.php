<?php

declare(strict_types=1);

function handleCreateProject(PDO $db, array $config): never
{
    $tokenHash = extractTokenHash();
    if ($tokenHash === null) {
        sendError('Missing or invalid Authorization header', 401);
    }

    // Per-owner project limit to prevent storage abuse
    $ownerProjectCount = dbCountProjectsByOwner($db, $tokenHash);
    if ($ownerProjectCount >= LIMITS['MAX_PROJECTS_PER_OWNER']) {
        sendError('Project limit reached. Delete existing projects before creating new ones.', 429);
    }

    $body = readJsonBody();

    $validation = validateProjectData($body['data'] ?? null);
    if (!$validation['valid']) {
        sendError($validation['error'], 400);
    }

    // Visibility (optional, defaults to 'private')
    $visibility = 'private';
    if (isset($body['visibility'])) {
        if (!isValidVisibility($body['visibility'])) {
            sendError('visibility must be "private" or "unlisted"', 400);
        }
        $visibility = $body['visibility'];
    }

    // Extract title from project metadata for the denormalized column
    $title = $body['data']['project']['title'] ?? null;
    if ($title !== null) {
        $title = mb_substr($title, 0, 500);
    }

    $dataJson = extractRawDataJson();

    // Optimistic insert with retry on duplicate key (eliminates TOCTOU race)
    $id = null;
    for ($attempt = 0; $attempt < 3; $attempt++) {
        $candidate = generatePublicId();
        try {
            dbCreateProject($db, $candidate, $tokenHash, $visibility, $dataJson, $title);
            $id = $candidate;
            break;
        } catch (\PDOException $e) {
            // Retry on duplicate key error (SQLSTATE 23000)
            if ($e->getCode() === '23000' && $attempt < 2) {
                continue;
            }
            throw $e;
        }
    }

    if ($id === null) {
        sendError('Unable to generate a unique project ID. Please try again.', 503);
    }

    // Fetch timestamps only (lightweight query)
    $timestamps = dbGetProjectTimestamps($db, $id);

    $shareUrl = rtrim($config['app_url'], '/') . '/#/p/' . $id;

    sendJson([
        'id'        => $id,
        'shareUrl'  => $shareUrl,
        'createdAt' => $timestamps['created_at_iso'],
    ], 201);
}
