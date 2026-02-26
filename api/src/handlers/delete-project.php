<?php

declare(strict_types=1);

function handleDeleteProject(PDO $db, string $id): never
{
    requireOwnership($db, $id);
    dbDeleteProject($db, $id);
    sendNoContent();
}
