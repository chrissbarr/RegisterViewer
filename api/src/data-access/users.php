<?php

declare(strict_types=1);

/**
 * Data-access functions for the users table.
 */

/**
 * Find a user by email.
 */
function dbGetUserByEmail(PDO $db, string $email): ?array
{
    $stmt = $db->prepare('SELECT id, email FROM users WHERE email = :email LIMIT 1');
    $stmt->execute(['email' => $email]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Find a user by ID.
 */
function dbGetUserById(PDO $db, int $id): ?array
{
    $stmt = $db->prepare('SELECT id, email FROM users WHERE id = :id LIMIT 1');
    $stmt->execute(['id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Create a new user. Returns the auto-increment ID.
 */
function dbCreateUser(PDO $db, string $email): int
{
    $stmt = $db->prepare('INSERT INTO users (email) VALUES (:email)');
    $stmt->execute(['email' => $email]);
    return (int) $db->lastInsertId();
}

/**
 * Find an existing user by email, or create one if none exists.
 * Handles duplicate-key race conditions gracefully: if a concurrent
 * request creates the user between our SELECT and INSERT, the unique
 * constraint violation is caught and we re-fetch the user (SEC-N01).
 * Returns an associative array with 'id' (int) and 'email' (string).
 */
function dbFindOrCreateUser(PDO $db, string $email): array
{
    $user = dbGetUserByEmail($db, $email);
    if ($user !== null) {
        return $user;
    }
    try {
        $userId = dbCreateUser($db, $email);
        return ['id' => $userId, 'email' => $email];
    } catch (\PDOException $e) {
        if ($e->getCode() === '23000') {
            // Race: another request created the user first
            $user = dbGetUserByEmail($db, $email);
            if ($user !== null) {
                return $user;
            }
        }
        throw $e;
    }
}
