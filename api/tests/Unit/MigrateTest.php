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
        // Clean up temporary migration files
        $files = glob($this->migrationsDir . '/*');
        if ($files) {
            foreach ($files as $file) {
                unlink($file);
            }
        }
        rmdir($this->migrationsDir);
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
        $this->assertSame([], $result['errors']);
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
}
