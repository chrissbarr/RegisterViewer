<?php

declare(strict_types=1);

/**
 * Database migration runner.
 *
 * Usage: php database/migrate.php
 *
 * Scans the migrations/ directory for SQL files, compares against the
 * _migrations tracking table, and applies new migrations in order.
 */

// Load config
$config = require __DIR__ . '/../config.php';
$prodConfigPath = __DIR__ . '/../config.production.php';
if (file_exists($prodConfigPath)) {
    $config = array_replace_recursive($config, require $prodConfigPath);
}

require __DIR__ . '/../src/database.php';

$db = getDatabase($config);

// Create migration tracking table
$db->exec("CREATE TABLE IF NOT EXISTS `_migrations` (
    `version`    INT UNSIGNED    NOT NULL,
    `filename`   VARCHAR(255)    NOT NULL,
    `applied_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `checksum`   CHAR(64)        NOT NULL,
    PRIMARY KEY (`version`)
) ENGINE=InnoDB");

// Get already-applied versions
$applied = $db->query("SELECT version FROM _migrations")
    ->fetchAll(PDO::FETCH_COLUMN);

// Find and sort migration files
$migrationsDir = __DIR__ . '/migrations';
$files = glob("$migrationsDir/*.sql");
sort($files);

$count = 0;

foreach ($files as $file) {
    $basename = basename($file);
    if (!preg_match('/^(\d+)_/', $basename, $m)) {
        echo "Skipping (no version prefix): $basename\n";
        continue;
    }

    $version = (int) $m[1];

    if (in_array($version, $applied, false)) {
        echo "Already applied: $basename\n";
        continue;
    }

    $sql = file_get_contents($file);
    $checksum = hash('sha256', $sql);

    $db->beginTransaction();
    try {
        $db->exec($sql);
        $stmt = $db->prepare(
            "INSERT INTO _migrations (version, filename, checksum) VALUES (?, ?, ?)"
        );
        $stmt->execute([$version, $basename, $checksum]);
        $db->commit();
        echo "Applied: $basename\n";
        $count++;
    } catch (Exception $e) {
        $db->rollBack();
        echo "FAILED: $basename — {$e->getMessage()}\n";
        exit(1);
    }
}

if ($count === 0) {
    echo "No new migrations to apply.\n";
} else {
    echo "Applied $count migration(s) successfully.\n";
}
