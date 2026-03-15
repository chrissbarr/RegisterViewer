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
        // Create test user
        self::$db->exec("INSERT IGNORE INTO users (email) VALUES ('version-test@example.com')");
        $stmt = self::$db->prepare("SELECT id FROM users WHERE email = 'version-test@example.com'");
        $stmt->execute();
        self::$testUserId = (int)$stmt->fetchColumn();
    }

    protected function setUp(): void
    {
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

    private function createTestProject(string $publicId = 'test_ver_001'): void
    {
        dbCreateProject(
            self::$db,
            $publicId,
            'private',
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
            'private',
            'Updated',
            1, // matches default version
            self::$testUserId,
        );

        $this->assertTrue($result['updated']);
        $this->assertSame(2, $result['version']);
    }

    #[Test]
    public function versionedUpdateStaleVersionReturns409(): void
    {
        $this->createTestProject();

        // First update: version 1 -> 2
        $result1 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'private', 'V2', 1, self::$testUserId,
        );
        $this->assertTrue($result1['updated']);

        // Second update with stale version 1 (server is at 2)
        $result2 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'private', 'Stale', 1, self::$testUserId,
        );
        $this->assertFalse($result2['updated']);
        $this->assertSame(2, $result2['version']); // current server version
    }

    #[Test]
    public function versionLifecycle(): void
    {
        $this->createTestProject();

        // Create: version=1
        $v = dbGetProjectVersion(self::$db, 'test_ver_001');
        $this->assertSame(1, $v);

        // Update 1: version 1->2
        $r1 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'private', 'V2', 1, self::$testUserId,
        );
        $this->assertSame(2, $r1['version']);

        // Update 2: version 2->3
        $r2 = dbUpdateProjectVersioned(
            self::$db, 'test_ver_001',
            '{"registers":[],"registerValues":{}}',
            'private', 'V3', 2, self::$testUserId,
        );
        $this->assertSame(3, $r2['version']);

        // GET: version=3
        $v2 = dbGetProjectVersion(self::$db, 'test_ver_001');
        $this->assertSame(3, $v2);
    }

    #[Test]
    public function getProjectVersionFallsBackTo1ForMissingProject(): void
    {
        $v = dbGetProjectVersion(self::$db, 'nonexistent_xx');
        $this->assertSame(1, $v);
    }
}
