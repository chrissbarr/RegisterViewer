<?php

declare(strict_types=1);

/**
 * Extract the SHA-256 token hash from the Authorization header.
 *
 * Expects: Authorization: Bearer <64-char lowercase hex>
 *
 * Checks both HTTP_AUTHORIZATION and REDIRECT_HTTP_AUTHORIZATION
 * because Apache on cPanel may strip the Authorization header.
 */
function extractTokenHash(): ?string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

    // Apache + cPanel may strip Authorization header; check redirect variant
    if (empty($header)) {
        $header = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    }

    if (empty($header)) {
        return null;
    }

    $parts = explode(' ', $header, 2);
    if (count($parts) !== 2 || $parts[0] !== 'Bearer') {
        return null;
    }

    $hash = strtolower($parts[1]);
    if (!preg_match('/^[0-9a-f]{64}$/', $hash)) {
        return null;
    }

    return $hash;
}

/**
 * Check whether a token hash matches the project's owner token hash.
 * Uses hash_equals() for constant-time comparison.
 */
function isOwner(string $tokenHash, array $project): bool
{
    return hash_equals($project['owner_token_hash'], $tokenHash);
}

/**
 * Verify auth token and project ownership. Returns the project row on success.
 * Calls sendError() (which exits) on failure.
 */
function requireOwnership(PDO $db, string $id): array
{
    $tokenHash = extractTokenHash();
    if ($tokenHash === null) {
        sendError('Missing or invalid Authorization header', 401);
    }

    $project = dbGetProjectForAuth($db, $id);
    if ($project === null || !isOwner($tokenHash, $project)) {
        sendError('Project not found', 404);
    }

    return $project;
}
