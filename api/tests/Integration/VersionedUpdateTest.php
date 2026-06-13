<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * Integration tests for versioned project updates (optimistic concurrency).
 * Requires database connection (docker compose test environment).
 */
final class VersionedUpdateTest extends TestCase
{
    private static ?PDO $db = null;
    private static ?int $testUserId = null;

    public static function setUpBeforeClass(): void
    {
        $host = getenv('DB_HOST') ?: '127.0.0.1';
        $port = (int) (getenv('DB_PORT') ?: 3306);
        $database = getenv('DB_DATABASE') ?: 'register_viewer';
        $username = getenv('DB_USERNAME') ?: 'regapi';
        $password = getenv('DB_PASSWORD') ?: 'regapi_dev';

        $dsn = "mysql:host=$host;port=$port;dbname=$database;charset=utf8mb4";
        self::$db = new PDO($dsn, $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        self::$db->exec("SET SESSION time_zone = '+00:00'");
        // Create test user
        self::$db->exec("INSERT IGNORE INTO users (email) VALUES ('version-test@example.com')");
        $stmt = self::$db->prepare("SELECT id FROM users WHERE email = 'version-test@example.com'");
        $stmt->execute();
        self::$testUserId = (int)$stmt->fetchColumn();
    }

    protected function setUp(): void
    {
        date_default_timezone_set('UTC');
        self::$db->exec("SET SESSION time_zone = '+00:00'");
        // Clean up test projects
        self::$db->exec("DELETE FROM projects WHERE user_id = " . self::$testUserId);
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$db && self::$testUserId) {
            self::$db->exec("DELETE FROM projects WHERE user_id = " . self::$testUserId);
            self::$db->exec("DELETE FROM users WHERE id = " . self::$testUserId);
        }
    }

    private function createTestProject(string $publicId = 'test_ver_001', string $visibility = 'private'): void
    {
        dbCreateProject(
            self::$db,
            $publicId,
            $visibility,
            '{"registers":[],"registerValues":{}}',
            'Test Project',
            self::$testUserId,
        );
    }

    #[Test]
    public function versionedUpdateMatchingVersionSucceeds(): void
    {
        $this->createTestProject();

        $result = dbUpdateProjectVersioned(
            self::$db,
            'test_ver_001',
            '{"registers":[],"registerValues":{"r1":"0xFF"}}',
            'Updated',
            1, // matches default version
            self::$testUserId,
        );

        $this->assertTrue($result['updated']);
        $this->assertSame(2, $result['version']);
    }

    #[Test]
    public function versionedUpdatePreservesVisibility(): void
    {
        $this->createTestProject('test_ver_001', 'unlisted');

        $result = dbUpdateProjectVersioned(
            self::$db,
            'test_ver_001',
            '{"registers":[],"registerValues":{"r1":"0xAA"}}',
            'Updated',
            1,
            self::$testUserId,
        );

        $this->assertTrue($result['updated']);

        $project = dbGetProject(self::$db, 'test_ver_001');
        $this->assertSame('unlisted', $project['visibility']);
        $this->assertSame(2, (int) $project['version']);
    }

    #[Test]
    public function versionedUpdateStaleVersionReturns409(): void
    {
        $this->createTestProject();

        // First update: version 1 -> 2
        $result1 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'V2', 1, self::$testUserId,
        );
        $this->assertTrue($result1['updated']);

        // Second update with stale version 1 (server is at 2)
        $result2 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'Stale', 1, self::$testUserId,
        );
        $this->assertFalse($result2['updated']);
        $this->assertSame(2, $result2['version']); // current server version
    }

    #[Test]
    public function versionLifecycle(): void
    {
        $this->createTestProject();

        // Create: version=1
        $created = dbGetProjectMeta(self::$db, 'test_ver_001');
        $this->assertSame(1, (int) $created['version']);

        // Update 1: version 1->2
        $r1 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'V2', 1, self::$testUserId,
        );
        $this->assertSame(2, $r1['version']);

        // Update 2: version 2->3
        $r2 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'V3', 2, self::$testUserId,
        );
        $this->assertSame(3, $r2['version']);

        // GET: version=3
        $final = dbGetProjectMeta(self::$db, 'test_ver_001');
        $this->assertSame(3, (int) $final['version']);
    }

    #[Test]
    public function concurrentSameVersionUpdateOnlyOneSucceeds(): void
    {
        $this->createTestProject();

        $result1 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'Edit A', 1, self::$testUserId,
        );
        $result2 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'Edit B', 1, self::$testUserId,
        );

        $this->assertTrue($result1['updated']);
        $this->assertFalse($result2['updated']);
        $this->assertSame(2, $result2['version']);
    }

    #[Test]
    public function versionedUpdateReturnsNullVersionForConcurrentlyDeletedRow(): void
    {
        $this->createTestProject();

        // Simulate a concurrent DELETE landing between ownership verification
        // and the versioned UPDATE's WHERE evaluation.
        dbDeleteProject(self::$db, 'test_ver_001');

        $result = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'Gone', 1, self::$testUserId,
        );

        $this->assertFalse($result['updated']);
        // version=null signals row-gone (404), not a fabricated version conflict.
        $this->assertNull($result['version']);
    }
}
