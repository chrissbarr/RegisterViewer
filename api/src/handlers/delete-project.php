<?php

declare(strict_types=1);

function handleDeleteProject(PDO $db, string $id, array $auth): ApiResponse
{
    $existing = requireOwnership($db, $id, $auth);
    if ($existing instanceof ApiResponse) {
        return $existing;
    }

    dbDeleteProject($db, $id);
    return new ApiResponse(null, 204);
}
