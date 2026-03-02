<?php

declare(strict_types=1);

function handleListProjects(PDO $db, array $auth): ApiResponse
{
    if ($auth['kind'] !== 'jwt') {
        return new ApiResponse(['error' => 'Authentication required'], 401);
    }

    $rows = dbListProjectsByUserId($db, $auth['userId']);

    $projects = array_map(fn(array $row) => [
        'id'         => $row['public_id'],
        'title'      => $row['title'],
        'visibility' => $row['visibility'],
        'createdAt'  => $row['created_at_iso'],
        'updatedAt'  => $row['updated_at_iso'],
    ], $rows);

    return new ApiResponse(['projects' => $projects], 200, [
        'Cache-Control' => 'private, no-store',
    ]);
}
