<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class MigrateTest extends TestCase
{
    private PDO $db;
    private string $migrationsDir;

    protected function setUp(): void
    {
        // Use in-memory SQLite for fast, isolated migration tests
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create a temporary migrations directory
        $this->migrationsDir = sys_get_temp_dir() . '/migrate_test_' . uniqid();
        mkdir($this->migrationsDir, 0755, true);
    }

    protected function tearDown(): void
    {
        // Clean up temporary migration files (including dotfiles such as .ready-* sentinels)
        $files = glob($this->migrationsDir . '/*');
        if ($files) {
            foreach ($files as $file) {
                unlink($file);
            }
        }
        $dotFiles = glob($this->migrationsDir . '/.*');
        if ($dotFiles) {
            foreach ($dotFiles as $file) {
                if (!in_array(basename($file), ['.', '..'], true)) {
                    unlink($file);
                }
            }
        }
        rmdir($this->migrationsDir);
    }

    private function writeMigration(string $filename, string $sql): void
    {
        file_put_contents($this->migrationsDir . '/' . $filename, $sql);
    }

    private function requiredSchemaSql(bool $includeProjectVersion = true): string
    {
        $projectVersionColumn = $includeProjectVersion ? ', version INTEGER NOT NULL DEFAULT 1' : '';

        return "
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                public_id TEXT NOT NULL,
                user_id INTEGER,
                visibility TEXT NOT NULL,
                title TEXT,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                schema_version INTEGER NOT NULL DEFAULT 1
                $projectVersionColumn
            );
            CREATE TABLE login_codes (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL,
                code_verifier CHAR(64) NOT NULL,
                expires_at TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                used INTEGER NOT NULL DEFAULT 0,
                ip_address TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX ix_login_codes_email_latest ON login_codes (email, created_at DESC, id DESC);
            CREATE INDEX ix_login_codes_email_active ON login_codes (email, used, expires_at);
            CREATE TABLE auth_rate_limits (
                scope TEXT NOT NULL,
                identity_hash TEXT NOT NULL,
                bucket_start TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                expires_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (scope, identity_hash, bucket_start)
            );
            CREATE TABLE revoked_tokens (
                jti TEXT PRIMARY KEY,
                expires_at TEXT NOT NULL,
                revoked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        ";
    }

    private function idempotentRequiredSchemaSql(): string
    {
        return str_replace(
            ['CREATE TABLE ', 'CREATE INDEX '],
            ['CREATE TABLE IF NOT EXISTS ', 'CREATE INDEX IF NOT EXISTS '],
            $this->requiredSchemaSql()
        );
    }

    private function recordAppliedMigration(int $version, string $filename, string $sql, ?string $checksum = null): void
    {
        ensureMigrationTrackingTable($this->db);
        $stmt = $this->db->prepare(
            'INSERT INTO _migrations (version, filename, checksum) VALUES (?, ?, ?)'
        );
        $stmt->execute([$version, $filename, $checksum ?? hash('sha256', $sql)]);
    }

    #[Test]
    public function returnsEmptyWhenNoMigrationFiles(): void
    {
        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertSame([], $result['applied']);
        $this->assertSame([], $result['skipped']);
        $this->assertSame([], $result['errors']);
    }

    #[Test]
    public function appliesSingleMigration(): void
    {
        file_put_contents(
            $this->migrationsDir . '/001_create_test.sql',
            'CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)'
        );

        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertSame(['001_create_test.sql'], $result['applied']);
        $this->assertSame([], $result['errors']);

        // Verify table was created
        $tables = $this->db->query("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'")
            ->fetchAll(PDO::FETCH_COLUMN);
        $this->assertContains('test_table', $tables);
    }

    #[Test]
    public function appliesMigrationsInOrder(): void
    {
        file_put_contents(
            $this->migrationsDir . '/002_add_column.sql',
            'CREATE TABLE second_table (id INTEGER PRIMARY KEY)'
        );
        file_put_contents(
            $this->migrationsDir . '/001_create_first.sql',
            'CREATE TABLE first_table (id INTEGER PRIMARY KEY)'
        );

        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertSame(['001_create_first.sql', '002_add_column.sql'], $result['applied']);
    }

    #[Test]
    public function skipsAlreadyAppliedMigrations(): void
    {
        file_put_contents(
            $this->migrationsDir . '/001_create_test.sql',
            'CREATE TABLE test_table (id INTEGER PRIMARY KEY)'
        );

        // Apply once
        runPendingMigrations($this->db, $this->migrationsDir);

        // Apply again — should be a no-op
        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertSame([], $result['applied']);
        $this->assertSame([], $result['errors']);
    }

    #[Test]
    public function skipsFilesWithoutVersionPrefix(): void
    {
        file_put_contents(
            $this->migrationsDir . '/readme.sql',
            '-- This is not a migration'
        );

        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertSame(['readme.sql'], $result['skipped']);
        $this->assertSame([], $result['applied']);
    }

    #[Test]
    public function reportsErrorsForInvalidSql(): void
    {
        file_put_contents(
            $this->migrationsDir . '/001_bad_sql.sql',
            'THIS IS NOT VALID SQL AT ALL'
        );

        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertSame([], $result['applied']);
        $this->assertCount(1, $result['errors']);
        $this->assertStringContainsString('001_bad_sql.sql', $result['errors'][0]);
    }

    #[Test]
    public function appliesOnlyNewMigrationsOnSecondRun(): void
    {
        file_put_contents(
            $this->migrationsDir . '/001_first.sql',
            'CREATE TABLE first_table (id INTEGER PRIMARY KEY)'
        );

        runPendingMigrations($this->db, $this->migrationsDir);

        // Add a second migration
        file_put_contents(
            $this->migrationsDir . '/002_second.sql',
            'CREATE TABLE second_table (id INTEGER PRIMARY KEY)'
        );

        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertSame(['002_second.sql'], $result['applied']);
    }

    #[Test]
    public function recordsChecksumInTrackingTable(): void
    {
        $sql = 'CREATE TABLE test_table (id INTEGER PRIMARY KEY)';
        file_put_contents($this->migrationsDir . '/001_test.sql', $sql);

        runPendingMigrations($this->db, $this->migrationsDir);

        $row = $this->db->query("SELECT version, filename, checksum FROM _migrations WHERE version = 1")
            ->fetch(PDO::FETCH_ASSOC);

        $this->assertSame(1, (int) $row['version']);
        $this->assertSame('001_test.sql', $row['filename']);
        $this->assertSame(hash('sha256', $sql), $row['checksum']);
    }

    #[Test]
    public function handlesEmptyMigrationsDirectory(): void
    {
        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertSame([], $result['applied']);
        $this->assertSame([], $result['skipped']);
        $this->assertSame([], $result['errors']);
    }

    #[Test]
    public function handlesNonexistentMigrationsDirectory(): void
    {
        $result = runPendingMigrations($this->db, '/nonexistent/path/to/migrations');

        $this->assertSame([], $result['applied']);
        $this->assertSame([], $result['skipped']);
        $this->assertCount(1, $result['errors']);
        $this->assertStringContainsString('Migrations directory does not exist', $result['errors'][0]);
    }

    #[Test]
    public function failedMigrationHaltsSubsequent(): void
    {
        file_put_contents(
            $this->migrationsDir . '/001_bad.sql',
            'INVALID SQL STATEMENT'
        );
        file_put_contents(
            $this->migrationsDir . '/002_good.sql',
            'CREATE TABLE good_table (id INTEGER PRIMARY KEY)'
        );

        $result = runPendingMigrations($this->db, $this->migrationsDir);

        $this->assertCount(1, $result['errors']);
        $this->assertStringContainsString('001_bad.sql', $result['errors'][0]);
        // Halts on first error — later migrations may depend on earlier ones
        $this->assertNotContains('002_good.sql', $result['applied']);
    }

    #[Test]
    public function createsMigrationTrackingTable(): void
    {
        runPendingMigrations($this->db, $this->migrationsDir);

        $tables = $this->db->query("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
            ->fetchAll(PDO::FETCH_COLUMN);
        $this->assertContains('_migrations', $tables);
    }

    #[Test]
    public function scanMigrationFilesReportsNumberedSortedSkippedAndDuplicateVersions(): void
    {
        $this->writeMigration('010_tenth.sql', 'SELECT 10');
        $this->writeMigration('002_a_second.sql', 'SELECT 2');
        $this->writeMigration('readme.sql', 'SELECT 0');
        $this->writeMigration('002_z_duplicate.sql', 'SELECT 22');

        $scan = scanMigrationFiles($this->migrationsDir);

        $this->assertSame(['002_a_second.sql', '010_tenth.sql'], array_column($scan['numbered'], 'filename'));
        $this->assertSame(['readme.sql'], $scan['skipped']);
        $this->assertCount(1, $scan['errors']);
        $this->assertStringContainsString('Duplicate migration version 2', $scan['errors'][0]);
    }

    #[Test]
    public function ensureSchemaReadyAppliesPendingMigrationAndReportsReady(): void
    {
        $sql = $this->requiredSchemaSql();
        $this->writeMigration('001_create_required_schema.sql', $sql);

        $result = ensureSchemaReady(
            $this->db,
            $this->migrationsDir,
            $this->migrationsDir . '/schema.lock'
        );

        $this->assertTrue($result['ready']);
        $this->assertSame('ready', $result['status']);
        $this->assertSame(['001_create_required_schema.sql'], $result['migrationResult']['applied']);
        $this->assertSame([1], $result['readiness']['appliedMigrations']);
        $this->assertSame([], $result['readiness']['pendingMigrations']);
        $this->assertTrue($result['readiness']['schema']['projects.version']);
    }

    #[Test]
    public function schemaReadinessFailsWhenProjectsVersionColumnIsMissing(): void
    {
        $sql = $this->requiredSchemaSql(includeProjectVersion: false);
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql);

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('schema_invalid', $readiness['status']);
        $this->assertFalse($readiness['schema']['projects.version']);
        $this->assertContains('Required schema column missing: projects.version', $readiness['errors']);
    }

    #[Test]
    public function schemaReadinessFailsWhenAuthRateLimitTableIsMissing(): void
    {
        $sql = str_replace(
            "CREATE TABLE auth_rate_limits (
                scope TEXT NOT NULL,
                identity_hash TEXT NOT NULL,
                bucket_start TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                expires_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (scope, identity_hash, bucket_start)
            );",
            '',
            $this->requiredSchemaSql()
        );
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql);

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('schema_invalid', $readiness['status']);
        $this->assertFalse($readiness['schema']['auth_rate_limits.scope']);
        $this->assertContains('Required schema column missing: auth_rate_limits.scope', $readiness['errors']);
    }

    #[Test]
    public function schemaReadinessFailsWhenLoginCodeVerifierColumnIsMissing(): void
    {
        $sql = str_replace(
            'code_verifier CHAR(64) NOT NULL,',
            '',
            $this->requiredSchemaSql()
        );
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql);

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('schema_invalid', $readiness['status']);
        $this->assertFalse($readiness['schema']['login_codes.code_verifier']);
        $this->assertContains('Required schema column missing: login_codes.code_verifier', $readiness['errors']);
    }

    #[Test]
    public function schemaReadinessFailsWhenLoginCodeVerifierShapeIsInvalid(): void
    {
        $sql = str_replace(
            'code_verifier CHAR(64) NOT NULL',
            'code_verifier TEXT',
            $this->requiredSchemaSql()
        );
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql);

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('schema_invalid', $readiness['status']);
        $this->assertContains('Required schema column has invalid type: login_codes.code_verifier', $readiness['errors']);
        $this->assertContains('Required schema column must be NOT NULL: login_codes.code_verifier', $readiness['errors']);
    }

    #[Test]
    public function schemaReadinessFailsWhenLoginCodeLatestIndexIsMissing(): void
    {
        $sql = str_replace(
            'CREATE INDEX ix_login_codes_email_latest ON login_codes (email, created_at DESC, id DESC);',
            '',
            $this->requiredSchemaSql()
        );
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql);

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('schema_invalid', $readiness['status']);
        $this->assertContains(
            'Required schema index missing or invalid: login_codes.ix_login_codes_email_latest(email, created_at, id)',
            $readiness['errors']
        );
    }

    #[Test]
    public function schemaReadinessFailsWhenAuthRateLimitPrimaryKeyIsMissing(): void
    {
        $sql = str_replace(
            ',
                PRIMARY KEY (scope, identity_hash, bucket_start)',
            '',
            $this->requiredSchemaSql()
        );
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql);

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('schema_invalid', $readiness['status']);
        $this->assertContains(
            'Required schema primary key missing or invalid: auth_rate_limits(scope, identity_hash, bucket_start)',
            $readiness['errors']
        );
    }

    #[Test]
    public function schemaReadinessFailsOnMigrationChecksumMismatch(): void
    {
        $sql = $this->requiredSchemaSql();
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql, str_repeat('0', 64));

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('migration_history_invalid', $readiness['status']);
        $this->assertContains('Migration 1 checksum mismatch for 001_create_required_schema.sql', $readiness['errors']);
    }

    #[Test]
    public function schemaReadinessFailsWhenNoNumberedMigrationFilesExist(): void
    {
        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('migration_history_invalid', $readiness['status']);
        $this->assertContains('No numbered migration files found', $readiness['migrationHistoryErrors']);
    }

    #[Test]
    public function schemaReadinessFailsOnAppliedMigrationWithoutDeployedFile(): void
    {
        $this->recordAppliedMigration(99, '099_future.sql', 'SELECT 99');
        $this->writeMigration('001_create_required_schema.sql', $this->requiredSchemaSql());

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('migration_history_invalid', $readiness['status']);
        $this->assertContains(
            'Applied migration 99 has no deployed migration file: 099_future.sql',
            $readiness['migrationHistoryErrors']
        );
    }

    #[Test]
    public function ensureSchemaReadyDoesNotApplyPendingMigrationsAfterChecksumMismatch(): void
    {
        $sql = $this->requiredSchemaSql();
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->writeMigration('002_should_not_run.sql', 'CREATE TABLE should_not_run (id INTEGER PRIMARY KEY)');
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql, str_repeat('0', 64));

        $result = ensureSchemaReady(
            $this->db,
            $this->migrationsDir,
            $this->migrationsDir . '/schema.lock'
        );

        $this->assertFalse($result['ready']);
        $this->assertSame('migration_history_invalid', $result['status']);
        $this->assertSame([], $result['migrationResult']['applied']);
        $tables = $this->db->query("SELECT name FROM sqlite_master WHERE type='table' AND name='should_not_run'")
            ->fetchAll(PDO::FETCH_COLUMN);
        $this->assertSame([], $tables);
    }

    #[Test]
    public function ensureSchemaReadyCanRecordAlreadyInitializedSchemaWithIdempotentMigrations(): void
    {
        $schemaSql = $this->requiredSchemaSql();
        $this->db->exec($schemaSql);
        $this->writeMigration('001_create_required_schema.sql', $this->idempotentRequiredSchemaSql());
        $this->writeMigration('002_schema_already_has_version.sql', 'SELECT 1');

        $result = ensureSchemaReady(
            $this->db,
            $this->migrationsDir,
            $this->migrationsDir . '/schema.lock'
        );

        $this->assertTrue($result['ready']);
        $this->assertSame(
            ['001_create_required_schema.sql', '002_schema_already_has_version.sql'],
            $result['migrationResult']['applied']
        );
    }

    #[Test]
    public function schemaReadinessFailsWhenProjectsVersionShapeIsWrong(): void
    {
        $sql = str_replace(
            'version INTEGER NOT NULL DEFAULT 1',
            'version TEXT DEFAULT NULL',
            $this->requiredSchemaSql()
        );
        $filename = '001_create_required_schema.sql';
        $this->writeMigration($filename, $sql);
        $this->db->exec($sql);
        $this->recordAppliedMigration(1, $filename, $sql);

        $readiness = getSchemaReadiness($this->db, $this->migrationsDir);

        $this->assertFalse($readiness['ready']);
        $this->assertSame('schema_invalid', $readiness['status']);
        $this->assertContains('Required schema column has invalid type: projects.version', $readiness['errors']);
        $this->assertContains('Required schema column must be NOT NULL: projects.version', $readiness['errors']);
        $this->assertContains('Required schema column must default to 1: projects.version', $readiness['errors']);
    }

    #[Test]
    public function testSchemaFingerprintChangesWhenAMigrationFileChanges(): void
    {
        $dir = sys_get_temp_dir() . '/fp_' . bin2hex(random_bytes(6));
        mkdir($dir);
        file_put_contents("$dir/001_a.sql", 'CREATE TABLE a (id INT);');
        $fp1 = schemaFingerprint($dir);

        // A new migration file changes the fingerprint.
        file_put_contents("$dir/002_b.sql", 'CREATE TABLE b (id INT);');
        $fp2 = schemaFingerprint($dir);

        $this->assertNotSame('', $fp1);
        $this->assertNotSame($fp1, $fp2);

        // Stable when nothing changes.
        $this->assertSame($fp2, schemaFingerprint($dir));

        array_map('unlink', glob("$dir/*"));
        rmdir($dir);
    }

    #[Test]
    public function testReadinessSentinelPathAndStaleCleanup(): void
    {
        $dir = sys_get_temp_dir() . '/sn_' . bin2hex(random_bytes(6));
        mkdir($dir);
        touch(readinessSentinelPath($dir, 'OLDFP'));
        touch(readinessSentinelPath($dir, 'KEEPFP'));

        clearStaleReadinessSentinels($dir, 'KEEPFP');

        $this->assertFileDoesNotExist(readinessSentinelPath($dir, 'OLDFP'));
        $this->assertFileExists(readinessSentinelPath($dir, 'KEEPFP'));

        array_map('unlink', glob("$dir/.ready-*"));
        rmdir($dir);
    }

    #[Test]
    public function testEnsureSchemaReadyShortCircuitsOnSentinelHit(): void
    {
        $dir = sys_get_temp_dir() . '/esr_' . bin2hex(random_bytes(6));
        mkdir($dir);
        file_put_contents("$dir/001_x.sql", 'CREATE TABLE x (id INT);');
        $lock = "$dir/.migrate.lock";

        // Pre-create the sentinel matching the current fingerprint.
        $fp = schemaFingerprint($dir);
        touch(readinessSentinelPath($dir, $fp));

        // An in-memory PDO that would surface any query — the fast path must not query it.
        $db = new \PDO('sqlite::memory:');
        $db->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);

        $result = ensureSchemaReady($db, $dir, $lock);

        $this->assertTrue($result['ready']);
        $this->assertNull($result['readiness']); // short-circuit: no readiness detail computed
        $this->assertSame([], $result['migrationResult']['applied']);

        foreach (glob("$dir/*") ?: [] as $f) { unlink($f); }
        foreach (glob("$dir/.ready-*") ?: [] as $f) { unlink($f); }
        @unlink($lock);
        rmdir($dir);
    }

    #[Test]
    public function ensureSchemaReadyReturnsLockUnavailableWhenMigrationLockIsHeld(): void
    {
        $this->writeMigration('001_create_required_schema.sql', $this->requiredSchemaSql());
        $lockFile = $this->migrationsDir . '/schema.lock';
        $lock = fopen($lockFile, 'c');
        $this->assertNotFalse($lock);
        $this->assertTrue(flock($lock, LOCK_EX | LOCK_NB));

        try {
            $result = ensureSchemaReady($this->db, $this->migrationsDir, $lockFile);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }

        $this->assertFalse($result['ready']);
        $this->assertSame('lock_unavailable', $result['status']);
    }

    #[Test]
    public function ensureSchemaReadyReturnsMigrationFailedWhenPendingMigrationFails(): void
    {
        $this->writeMigration('001_bad.sql', 'INVALID SQL STATEMENT');

        $result = ensureSchemaReady(
            $this->db,
            $this->migrationsDir,
            $this->migrationsDir . '/schema.lock'
        );

        $this->assertFalse($result['ready']);
        $this->assertSame('migration_failed', $result['status']);
        $this->assertCount(1, $result['errors']);
        $this->assertStringContainsString('001_bad.sql', $result['errors'][0]);

        $lock = fopen($this->migrationsDir . '/schema.lock', 'c');
        $this->assertNotFalse($lock);
        $this->assertTrue(flock($lock, LOCK_EX | LOCK_NB));
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
