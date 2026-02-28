<?php

declare(strict_types=1);

function handleCreateProject(PDO $db, array $config, array $auth, array $parsed): ApiResponse
{
    $body = $parsed['assoc'];

    // Determine token hash and user ID based on auth method.
    // JWT users pass ownerTokenHash in the body (since the header carries the JWT).
    // Token-hash users pass it in the Authorization header as before.
    $userId = null;
    $tokenHash = null;

    if ($auth['kind'] === 'jwt') {
        $userId = $auth['userId'];
        $ownerTokenHash = $body['ownerTokenHash'] ?? null;
        if (is_string($ownerTokenHash) && preg_match('/^[0-9a-f]{64}$/', $ownerTokenHash)) {
            $tokenHash = $ownerTokenHash;
        }
    } elseif ($auth['kind'] === 'token') {
        $tokenHash = $auth['tokenHash'];
    }

    if ($tokenHash === null) {
        return new ApiResponse(['error' => 'Missing or invalid owner token'], 401);
    }

    // Per-owner project limit to prevent storage abuse
    $ownerProjectCount = dbCountProjectsByOwner($db, $tokenHash);
    if ($ownerProjectCount >= LIMITS['MAX_PROJECTS_PER_OWNER']) {
        return new ApiResponse(['error' => 'Project limit reached. Delete existing projects before creating new ones.'], 429);
    }

    // Per-user limit for JWT users: prevents bypass via multiple devices/browsers
    // (each device generates a different ownerTokenHash but shares the same userId)
    if ($userId !== null) {
        $userProjectCount = dbCountProjectsByUserId($db, $userId);
        if ($userProjectCount >= LIMITS['MAX_PROJECTS_PER_OWNER']) {
            return new ApiResponse(['error' => 'Project limit reached. Delete existing projects before creating new ones.'], 429);
        }
    }

    $validation = validateProjectData($body['data'] ?? null);
    if (!$validation['valid']) {
        return new ApiResponse(['error' => $validation['error']], 400);
    }

    // Visibility (optional, defaults to 'private')
    $visibility = 'private';
    if (isset($body['visibility'])) {
        if (!isValidVisibility($body['visibility'])) {
            return new ApiResponse(['error' => 'visibility must be "private" or "unlisted"'], 400);
        }
        $visibility = $body['visibility'];
    }

    // Extract title from project metadata for the denormalized column
    $title = $body['data']['project']['title'] ?? null;
    if ($title !== null) {
        $title = mb_substr($title, 0, 500);
    }

    $dataJson = extractDataJson($parsed['object']);
    if ($dataJson instanceof ApiResponse) {
        return $dataJson;
    }

    // Optimistic insert with retry on duplicate key (eliminates TOCTOU race)
    $id = null;
    for ($attempt = 0; $attempt < 3; $attempt++) {
        $candidate = generatePublicId();
        try {
            dbCreateProject($db, $candidate, $tokenHash, $visibility, $dataJson, $title, $userId);
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
        return new ApiResponse(['error' => 'Unable to generate a unique project ID. Please try again.'], 503);
    }

    // Fetch timestamps only (lightweight query)
    $timestamps = dbGetProjectTimestamps($db, $id);

    $shareUrl = rtrim($config['app_url'], '/') . '/#/p/' . $id;

    return new ApiResponse([
        'id'        => $id,
        'shareUrl'  => $shareUrl,
        'createdAt' => $timestamps['created_at_iso'],
    ], 201);
}
