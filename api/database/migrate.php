<?php

declare(strict_types=1);

/**
 * Database migration runner.
 *
 * Can be used as a CLI script: php database/migrate.php
 * Or imported for programmatic use: runPendingMigrations($db, $migrationsDir)
 */

/**
 * Run all pending database migrations.
 *
 * Scans the migrations directory for SQL files, compares against the
 * _migrations tracking table, and applies new migrations in order.
 *
 * @param PDO    $db            Database connection
 * @param string $migrationsDir Path to directory containing *.sql migration files
 * @return array{applied: string[], skipped: string[], errors: string[]}
 */
function runPendingMigrations(PDO $db, string $migrationsDir): array
{
    $result = ['applied' => [], 'skipped' => [], 'errors' => []];

    // Create migration tracking table (portable SQL for MySQL and SQLite)
    $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
    $engine = $driver === 'mysql' ? ' ENGINE=InnoDB' : '';
    $db->exec("CREATE TABLE IF NOT EXISTS _migrations (
        version     INTEGER      NOT NULL,
        filename    VARCHAR(255) NOT NULL,
        applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        checksum    CHAR(64)     NOT NULL,
        PRIMARY KEY (version)
    )$engine");

    // Get already-applied versions (cast to int for strict comparison)
    $applied = array_map('intval', $db->query("SELECT version FROM _migrations")
        ->fetchAll(PDO::FETCH_COLUMN));

    // Find and sort migration files
    $files = glob("$migrationsDir/*.sql");
    if ($files === false) {
        $files = [];
    }
    sort($files);

    foreach ($files as $file) {
        $basename = basename($file);
        if (!preg_match('/^(\d+)_/', $basename, $m)) {
            $result['skipped'][] = $basename;
            continue;
        }

        $version = (int) $m[1];

        if (in_array($version, $applied, true)) {
            continue;
        }

        $sql = file_get_contents($file);
        $checksum = hash('sha256', $sql);

        try {
            // Run migration SQL outside a transaction — MySQL implicitly commits
            // on DDL statements (CREATE TABLE, ALTER TABLE, etc.), which would
            // break an explicit transaction with "There is no active transaction".
            $db->exec($sql);
            $stmt = $db->prepare(
                "INSERT INTO _migrations (version, filename, checksum) VALUES (?, ?, ?)"
            );
            $stmt->execute([$version, $basename, $checksum]);
            $result['applied'][] = $basename;
        } catch (\Exception $e) {
            $result['errors'][] = "$basename: {$e->getMessage()}";
            break; // Halt on first error — later migrations may depend on this one
        }
    }

    return $result;
}

// CLI mode: run directly when invoked as a script
if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === realpath(__FILE__)) {
    $config = require __DIR__ . '/../config.php';
    $prodConfigPath = __DIR__ . '/../config.production.php';
    if (file_exists($prodConfigPath)) {
        $config = array_replace_recursive($config, require $prodConfigPath);
    }

    require __DIR__ . '/../src/database.php';

    $db = getDatabase($config);
    $migrationsDir = __DIR__ . '/migrations';

    $result = runPendingMigrations($db, $migrationsDir);

    foreach ($result['skipped'] as $file) {
        echo "Skipping (no version prefix): $file\n";
    }

    foreach ($result['applied'] as $file) {
        echo "Applied: $file\n";
    }

    foreach ($result['errors'] as $error) {
        echo "FAILED: $error\n";
        exit(1);
    }

    if (count($result['applied']) === 0) {
        echo "No new migrations to apply.\n";
    } else {
        echo "Applied " . count($result['applied']) . " migration(s) successfully.\n";
    }
}
