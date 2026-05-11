<?php

declare(strict_types=1);

function handleCreateProject(PDO $db, array $config, array $auth, array|\Closure $bodySource): ApiResponse
{
    if ($auth['kind'] !== 'jwt') {
        return new ApiResponse(['error' => 'Authentication required'], 401);
    }

    $userId = $auth['userId'];

    // Per-user project limit to prevent storage abuse
    $userProjectCount = dbCountProjectsByUserId($db, $userId);
    if ($userProjectCount >= LIMITS['MAX_PROJECTS_PER_USER']) {
        return new ApiResponse(['error' => 'Project limit reached. Delete existing projects before creating new ones.'], 429);
    }

    $parsed = resolveParsedBody($bodySource);
    if ($parsed instanceof ApiResponse) {
        return $parsed;
    }
    $body = $parsed['assoc'];

    $shapeValidation = validateProjectDataJsonShape($parsed['object']->data ?? null);
    if (!$shapeValidation['valid']) {
        return new ApiResponse(['error' => $shapeValidation['error']], 400);
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
            dbCreateProject($db, $candidate, $visibility, $dataJson, $title, $userId);
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
        'version'   => 1,
    ], 201);
}
