<?php

declare(strict_types=1);

date_default_timezone_set('UTC');

/**
 * Database migration runner.
 *
 * Can be used as a CLI script: php database/migrate.php
 * Or imported for programmatic use: runPendingMigrations($db, $migrationsDir)
 */

/**
 * Ensure the migration tracking table exists.
 */
function ensureMigrationTrackingTable(PDO $db): void
{
    $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
    $engine = $driver === 'mysql' ? ' ENGINE=InnoDB' : '';
    $db->exec("CREATE TABLE IF NOT EXISTS _migrations (
        version     INTEGER      NOT NULL,
        filename    VARCHAR(255) NOT NULL,
        applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        checksum    CHAR(64)     NOT NULL,
        PRIMARY KEY (version)
    )$engine");
}

/**
 * Scan SQL migrations and split numbered migrations from support files.
 *
 * @return array{
 *     numbered: array<int, array{version: int, filename: string, path: string, sql: string, checksum: string}>,
 *     skipped: string[],
 *     errors: string[]
 * }
 */
function scanMigrationFiles(string $migrationsDir): array
{
    $result = ['numbered' => [], 'skipped' => [], 'errors' => []];

    if (!is_dir($migrationsDir)) {
        $result['errors'][] = "Migrations directory does not exist: $migrationsDir";
        return $result;
    }
    if (!is_readable($migrationsDir)) {
        $result['errors'][] = "Migrations directory is not readable: $migrationsDir";
        return $result;
    }

    $files = glob(rtrim($migrationsDir, "/\\") . '/*.sql');
    if ($files === false) {
        $result['errors'][] = "Unable to scan migrations directory: $migrationsDir";
        return $result;
    }

    sort($files, SORT_STRING);
    $seenVersions = [];

    foreach ($files as $file) {
        $basename = basename($file);
        if (!preg_match('/^(\d+)_.*\.sql$/', $basename, $m)) {
            $result['skipped'][] = $basename;
            continue;
        }

        $version = (int) $m[1];
        if (array_key_exists($version, $seenVersions)) {
            $result['errors'][] = sprintf(
                'Duplicate migration version %d: %s and %s',
                $version,
                $seenVersions[$version],
                $basename
            );
            continue;
        }

        $sql = file_get_contents($file);
        if ($sql === false) {
            $result['errors'][] = "Unable to read migration file: $basename";
            continue;
        }

        $seenVersions[$version] = $basename;
        $result['numbered'][] = [
            'version'  => $version,
            'filename' => $basename,
            'path'     => $file,
            'sql'      => $sql,
            'checksum' => hash('sha256', $sql),
        ];
    }

    usort(
        $result['numbered'],
        fn(array $a, array $b): int => $a['version'] <=> $b['version']
            ?: strcmp($a['filename'], $b['filename'])
    );

    return $result;
}

/**
 * Return applied migrations keyed by version.
 *
 * @return array<int, array{version: int, filename: string, checksum: string}>
 */
function getAppliedMigrations(PDO $db): array
{
    $rows = $db->query('SELECT version, filename, checksum FROM _migrations')
        ->fetchAll(PDO::FETCH_ASSOC);

    $applied = [];
    foreach ($rows as $row) {
        $version = (int) $row['version'];
        $applied[$version] = [
            'version'  => $version,
            'filename' => (string) $row['filename'],
            'checksum' => (string) $row['checksum'],
        ];
    }

    ksort($applied, SORT_NUMERIC);
    return $applied;
}

/**
 * @param array{
 *     numbered: array<int, array{version: int, filename: string, path: string, sql: string, checksum: string}>,
 *     skipped: string[],
 *     errors: string[]
 * } $scan
 * @param array<int, array{version: int, filename: string, checksum: string}> $applied
 * @return string[]
 */
function getMigrationHistoryErrors(array $scan, array $applied): array
{
    $errors = $scan['errors'];
    $expected = [];

    foreach ($scan['numbered'] as $migration) {
        $version = $migration['version'];
        $expected[$version] = $migration;

        if (!array_key_exists($version, $applied)) {
            continue;
        }
        if ($applied[$version]['filename'] !== $migration['filename']) {
            $errors[] = sprintf(
                'Migration %d filename mismatch: expected %s, found %s',
                $version,
                $migration['filename'],
                $applied[$version]['filename']
            );
        }
        if ($applied[$version]['checksum'] !== $migration['checksum']) {
            $errors[] = sprintf(
                'Migration %d checksum mismatch for %s',
                $version,
                $migration['filename']
            );
        }
    }

    foreach ($applied as $version => $migration) {
        if (!array_key_exists($version, $expected)) {
            $errors[] = sprintf(
                'Applied migration %d has no deployed migration file: %s',
                $version,
                $migration['filename']
            );
        }
    }

    return $errors;
}

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

    try {
        ensureMigrationTrackingTable($db);
        $applied = getAppliedMigrations($db);
    } catch (\Throwable $e) {
        $result['errors'][] = 'Unable to initialize migration tracking: ' . $e->getMessage();
        return $result;
    }

    $scan = scanMigrationFiles($migrationsDir);
    $result['skipped'] = $scan['skipped'];
    $historyErrors = getMigrationHistoryErrors($scan, $applied);
    if ($historyErrors !== []) {
        $result['errors'] = $historyErrors;
        return $result;
    }

    foreach ($scan['numbered'] as $migration) {
        if (array_key_exists($migration['version'], $applied)) {
            continue;
        }

        try {
            // Run migration SQL outside a transaction because MySQL implicitly commits
            // on DDL statements (CREATE TABLE, ALTER TABLE, etc.), which would
            // break an explicit transaction with "There is no active transaction".
            $db->exec($migration['sql']);
            $stmt = $db->prepare(
                'INSERT INTO _migrations (version, filename, checksum) VALUES (?, ?, ?)'
            );
            $stmt->execute([$migration['version'], $migration['filename'], $migration['checksum']]);
            $applied[$migration['version']] = [
                'version'  => $migration['version'],
                'filename' => $migration['filename'],
                'checksum' => $migration['checksum'],
            ];
            $result['applied'][] = $migration['filename'];
        } catch (\Exception $e) {
            $result['errors'][] = "{$migration['filename']}: {$e->getMessage()}";
            break; // Halt on first error; later migrations may depend on this one
        }
    }

    return $result;
}

/**
 * @return array<string, string[]>
 */
function requiredSchemaColumns(): array
{
    return [
        '_migrations' => ['version', 'filename', 'applied_at', 'checksum'],
        'users' => ['id', 'email', 'created_at'],
        'projects' => [
            'id',
            'public_id',
            'user_id',
            'visibility',
            'title',
            'data',
            'created_at',
            'updated_at',
            'last_accessed_at',
            'schema_version',
            'version',
        ],
        'login_codes' => [
            'id',
            'email',
            'code_verifier',
            'expires_at',
            'attempts',
            'used',
            'ip_address',
            'created_at',
        ],
        'auth_rate_limits' => ['scope', 'identity_hash', 'bucket_start', 'attempt_count', 'expires_at', 'updated_at'],
        'revoked_tokens' => ['jti', 'expires_at', 'revoked_at'],
    ];
}

function getColumnInfo(PDO $db, string $table, string $column): ?array
{
    $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);

    if ($driver === 'sqlite') {
        $quotedTable = '"' . str_replace('"', '""', $table) . '"';
        $stmt = $db->query("PRAGMA table_info($quotedTable)");
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (($row['name'] ?? null) === $column) {
                return [
                    'type' => (string) ($row['type'] ?? ''),
                    'length' => null,
                    'nullable' => (int) ($row['notnull'] ?? 0) === 0,
                    'default' => $row['dflt_value'] ?? null,
                ];
            }
        }
        return null;
    }

    if ($driver === 'mysql') {
        $stmt = $db->prepare(
            'SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?
             LIMIT 1'
        );
        $stmt->execute([$table, $column]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }
        return [
            'type' => (string) ($row['DATA_TYPE'] ?? ''),
            'length' => isset($row['CHARACTER_MAXIMUM_LENGTH'])
                ? (int) $row['CHARACTER_MAXIMUM_LENGTH']
                : null,
            'nullable' => strtoupper((string) ($row['IS_NULLABLE'] ?? 'YES')) !== 'NO',
            'default' => $row['COLUMN_DEFAULT'] ?? null,
        ];
    }

    return schemaHasColumn($db, $table, $column)
        ? ['type' => '', 'length' => null, 'nullable' => false, 'default' => null]
        : null;
}

function schemaHasColumn(PDO $db, string $table, string $column): bool
{
    if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
        || $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
        return getColumnInfo($db, $table, $column) !== null;
    }

    $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);

    if ($driver === 'sqlite') {
        $quotedTable = '"' . str_replace('"', '""', $table) . '"';
        $stmt = $db->query("PRAGMA table_info($quotedTable)");
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (($row['name'] ?? null) === $column) {
                return true;
            }
        }
        return false;
    }

    if ($driver === 'mysql') {
        $stmt = $db->prepare(
            'SELECT COUNT(*)
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?'
        );
        $stmt->execute([$table, $column]);
        return (int) $stmt->fetchColumn() > 0;
    }

    $quotedTable = '"' . str_replace('"', '""', $table) . '"';
    $quotedColumn = '"' . str_replace('"', '""', $column) . '"';
    try {
        $db->query("SELECT $quotedColumn FROM $quotedTable WHERE 1 = 0");
        return true;
    } catch (\Throwable) {
        return false;
    }
}

/**
 * @return string[]
 */
function validateCriticalColumnShape(PDO $db, string $table, string $column): array
{
    $info = getColumnInfo($db, $table, $column);
    if ($info === null) {
        return [];
    }

    $errors = [];
    if ($table === 'login_codes' && $column === 'code_verifier') {
        $type = strtolower($info['type']);
        $length = $info['length'];
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
            && preg_match('/char\s*\(\s*(\d+)\s*\)/i', $type, $m) === 1) {
            $length = (int) $m[1];
            $type = 'char';
        }
        if ($type !== 'char' || $length !== 64) {
            $errors[] = 'Required schema column has invalid type: login_codes.code_verifier';
        }
        if ($info['nullable']) {
            $errors[] = 'Required schema column must be NOT NULL: login_codes.code_verifier';
        }
        return $errors;
    }

    if ($table !== 'projects' || $column !== 'version') {
        return [];
    }

    $type = strtolower($info['type']);
    if (!str_contains($type, 'int')) {
        $errors[] = 'Required schema column has invalid type: projects.version';
    }
    if ($info['nullable']) {
        $errors[] = 'Required schema column must be NOT NULL: projects.version';
    }
    $default = $info['default'];
    $normalizedDefault = $default === null
        ? null
        : trim((string) $default, " ()'\"");
    if ($normalizedDefault !== '1') {
        $errors[] = 'Required schema column must default to 1: projects.version';
    }

    return $errors;
}

/**
 * @return string[]
 */
function validateRequiredIndexShape(PDO $db): array
{
    $errors = [];
    if (!schemaHasPrimaryKeyColumns($db, 'auth_rate_limits', ['scope', 'identity_hash', 'bucket_start'])) {
        $errors[] = 'Required schema primary key missing or invalid: auth_rate_limits(scope, identity_hash, bucket_start)';
    }
    if (!schemaHasIndexColumns($db, 'login_codes', 'ix_login_codes_email_latest', ['email', 'created_at', 'id'])) {
        $errors[] = 'Required schema index missing or invalid: login_codes.ix_login_codes_email_latest(email, created_at, id)';
    }
    if (!schemaHasIndexColumns($db, 'login_codes', 'ix_login_codes_email_active', ['email', 'used', 'expires_at'])) {
        $errors[] = 'Required schema index missing or invalid: login_codes.ix_login_codes_email_active(email, used, expires_at)';
    }
    return $errors;
}

function schemaHasPrimaryKeyColumns(PDO $db, string $table, array $columns): bool
{
    $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);

    if ($driver === 'sqlite') {
        $quotedTable = '"' . str_replace('"', '""', $table) . '"';
        $stmt = $db->query("PRAGMA table_info($quotedTable)");
        $primaryKeyColumns = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $position = (int) ($row['pk'] ?? 0);
            if ($position > 0) {
                $primaryKeyColumns[$position] = (string) ($row['name'] ?? '');
            }
        }
        ksort($primaryKeyColumns, SORT_NUMERIC);
        return array_values($primaryKeyColumns) === $columns;
    }

    if ($driver === 'mysql') {
        $stmt = $db->prepare(
            'SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND INDEX_NAME = ?
             ORDER BY SEQ_IN_INDEX'
        );
        $stmt->execute([$table, 'PRIMARY']);
        return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN)) === $columns;
    }

    return true;
}

function schemaHasIndexColumns(PDO $db, string $table, string $index, array $columns): bool
{
    $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);

    if ($driver === 'sqlite') {
        $quotedIndex = '"' . str_replace('"', '""', $index) . '"';
        $stmt = $db->query("PRAGMA index_info($quotedIndex)");
        $indexColumns = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $indexColumns[(int) ($row['seqno'] ?? 0)] = (string) ($row['name'] ?? '');
        }
        ksort($indexColumns, SORT_NUMERIC);
        return array_values($indexColumns) === $columns;
    }

    if ($driver === 'mysql') {
        $stmt = $db->prepare(
            'SELECT COLUMN_NAME
             FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND INDEX_NAME = ?
             ORDER BY SEQ_IN_INDEX'
        );
        $stmt->execute([$table, $index]);
        return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN)) === $columns;
    }

    return true;
}

/**
 * Check migration history and the schema shape required by the API.
 *
 * @return array{
 *     ready: bool,
 *     status: string,
 *     errors: string[],
 *     appliedMigrations: int[],
 *     pendingMigrations: int[],
 *     schema: array<string, bool>,
 *     migrationHistoryErrors: string[]
 * }
 */
function getSchemaReadiness(PDO $db, string $migrationsDir): array
{
    $readiness = [
        'ready' => false,
        'status' => 'readiness_unknown',
        'errors' => [],
        'appliedMigrations' => [],
        'pendingMigrations' => [],
        'schema' => [],
        'migrationHistoryErrors' => [],
    ];

    try {
        ensureMigrationTrackingTable($db);
    } catch (\Throwable $e) {
        $readiness['errors'][] = 'Unable to initialize migration tracking: ' . $e->getMessage();
        return $readiness;
    }

    $scan = scanMigrationFiles($migrationsDir);
    try {
        $applied = getAppliedMigrations($db);
    } catch (\Throwable $e) {
        $readiness['errors'][] = 'Unable to read migration history: ' . $e->getMessage();
        return $readiness;
    }

    $readiness['appliedMigrations'] = array_values(array_map('intval', array_keys($applied)));
    $historyErrors = getMigrationHistoryErrors($scan, $applied);
    if ($scan['numbered'] === []) {
        $historyErrors[] = 'No numbered migration files found';
    }
    $readiness['migrationHistoryErrors'] = $historyErrors;
    $readiness['errors'] = array_merge($readiness['errors'], $historyErrors);

    foreach ($scan['numbered'] as $migration) {
        $version = $migration['version'];
        if (!array_key_exists($version, $applied)) {
            $readiness['pendingMigrations'][] = $version;
            continue;
        }
    }

    foreach (requiredSchemaColumns() as $table => $columns) {
        foreach ($columns as $column) {
            $key = "$table.$column";
            try {
                $hasColumn = schemaHasColumn($db, $table, $column);
            } catch (\Throwable $e) {
                $hasColumn = false;
                $readiness['errors'][] = "Unable to inspect $key: {$e->getMessage()}";
            }
            $readiness['schema'][$key] = $hasColumn;
            if (!$hasColumn) {
                $readiness['errors'][] = "Required schema column missing: $key";
            } else {
                $readiness['errors'] = array_merge(
                    $readiness['errors'],
                    validateCriticalColumnShape($db, $table, $column)
                );
            }
        }
    }
    $readiness['errors'] = array_merge($readiness['errors'], validateRequiredIndexShape($db));

    if ($readiness['migrationHistoryErrors'] !== []) {
        $readiness['status'] = 'migration_history_invalid';
    } elseif ($readiness['pendingMigrations'] !== []) {
        $readiness['status'] = 'migrations_pending';
    } elseif ($readiness['errors'] !== []) {
        $readiness['status'] = 'schema_invalid';
    } else {
        $readiness['ready'] = true;
        $readiness['status'] = 'ready';
    }

    return $readiness;
}

/**
 * Ensure all migrations are applied and the API-required schema is present.
 *
 * @return array{
 *     ready: bool,
 *     status: string,
 *     errors: string[],
 *     readiness: array,
 *     migrationResult: array{applied: string[], skipped: string[], errors: string[]}
 * }
 */
function ensureSchemaReady(PDO $db, string $migrationsDir, string $lockFile): array
{
    $emptyMigrationResult = ['applied' => [], 'skipped' => [], 'errors' => []];
    $readiness = getSchemaReadiness($db, $migrationsDir);
    if ($readiness['ready']) {
        return [
            'ready' => true,
            'status' => 'ready',
            'errors' => [],
            'readiness' => $readiness,
            'migrationResult' => $emptyMigrationResult,
        ];
    }
    if ($readiness['migrationHistoryErrors'] !== []) {
        return [
            'ready' => false,
            'status' => 'migration_history_invalid',
            'errors' => $readiness['migrationHistoryErrors'],
            'readiness' => $readiness,
            'migrationResult' => $emptyMigrationResult,
        ];
    }

    $fp = fopen($lockFile, 'c');
    if ($fp === false) {
        return [
            'ready' => false,
            'status' => 'readiness_unknown',
            'errors' => ['Unable to open migration lock file'],
            'readiness' => $readiness,
            'migrationResult' => $emptyMigrationResult,
        ];
    }

    if (!flock($fp, LOCK_EX | LOCK_NB)) {
        fclose($fp);
        return [
            'ready' => false,
            'status' => 'lock_unavailable',
            'errors' => ['Schema migration is already in progress'],
            'readiness' => $readiness,
            'migrationResult' => $emptyMigrationResult,
        ];
    }

    try {
        $readiness = getSchemaReadiness($db, $migrationsDir);
        if ($readiness['ready']) {
            return [
                'ready' => true,
                'status' => 'ready',
                'errors' => [],
                'readiness' => $readiness,
                'migrationResult' => $emptyMigrationResult,
            ];
        }
        if ($readiness['migrationHistoryErrors'] !== []) {
            return [
                'ready' => false,
                'status' => 'migration_history_invalid',
                'errors' => $readiness['migrationHistoryErrors'],
                'readiness' => $readiness,
                'migrationResult' => $emptyMigrationResult,
            ];
        }

        $migrationResult = runPendingMigrations($db, $migrationsDir);
        if ($migrationResult['errors'] !== []) {
            return [
                'ready' => false,
                'status' => 'migration_failed',
                'errors' => $migrationResult['errors'],
                'readiness' => getSchemaReadiness($db, $migrationsDir),
                'migrationResult' => $migrationResult,
            ];
        }

        $readiness = getSchemaReadiness($db, $migrationsDir);
        return [
            'ready' => $readiness['ready'],
            'status' => $readiness['status'],
            'errors' => $readiness['errors'],
            'readiness' => $readiness,
            'migrationResult' => $migrationResult,
        ];
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
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

    $result = ensureSchemaReady($db, $migrationsDir, __DIR__ . '/.migrate.lock');

    foreach ($result['migrationResult']['skipped'] as $file) {
        echo "Skipping (no version prefix): $file\n";
    }

    foreach ($result['migrationResult']['applied'] as $file) {
        echo "Applied: $file\n";
    }

    foreach ($result['errors'] as $error) {
        echo "FAILED: $error\n";
        exit(1);
    }
    foreach ($result['readiness']['errors'] as $error) {
        echo "FAILED: $error\n";
        exit(1);
    }

    if (!$result['ready']) {
        echo "FAILED: schema readiness status is {$result['status']}\n";
        exit(1);
    }

    if (count($result['migrationResult']['applied']) === 0) {
        echo "No new migrations to apply.\n";
    } else {
        echo "Applied " . count($result['migrationResult']['applied']) . " migration(s) successfully.\n";
    }
}
