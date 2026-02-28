<?php

declare(strict_types=1);

function handleDeleteProject(PDO $db, string $id, array $config): never
{
    requireOwnership($db, $id, $config);
    dbDeleteProject($db, $id);
    sendNoContent();
}
