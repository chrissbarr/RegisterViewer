<?php

declare(strict_types=1);

function handleListProjects(PDO $db): never
{
    $tokenHash = extractTokenHash();
    if ($tokenHash === null) {
        sendError('Missing or invalid Authorization header', 401);
    }

    $rows = dbListProjectsByOwner($db, $tokenHash);

    $projects = array_map(fn(array $row) => [
        'id'         => $row['public_id'],
        'visibility' => $row['visibility'],
        'createdAt'  => $row['created_at_iso'],
        'updatedAt'  => $row['updated_at_iso'],
    ], $rows);

    sendJson(['projects' => $projects], 200, [
        'Cache-Control' => 'private, no-store',
    ]);
}
