<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class ProjectApiTest extends TestCase
{
    private static ?PDO $db = null;

    private const OWNER_HASH = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';
    private const OTHER_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private static function validDataJson(): string
    {
        return json_encode([
            'version' => 1,
            'registers' => [
                ['name' => 'CTRL', 'width' => 8, 'fields' => []],
            ],
            'registerValues' => new \stdClass(),
        ], JSON_UNESCAPED_SLASHES);
    }

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
    }

    protected function setUp(): void
    {
        // Clean projects table before each test
        self::$db->exec('DELETE FROM projects');
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$db !== null) {
            self::$db->exec('DELETE FROM projects');
            self::$db = null;
        }
    }

    #[Test]
    public function createAndGetProject(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null);

        $project = dbGetProject(self::$db, $id);
        $this->assertNotNull($project);
        $this->assertSame($id, $project['public_id']);
        $this->assertSame(self::OWNER_HASH, $project['owner_token_hash']);
        $this->assertSame('private', $project['visibility']);
        $this->assertNotEmpty($project['data']);
    }

    #[Test]
    public function getNonExistentProjectReturnsNull(): void
    {
        $project = dbGetProject(self::$db, 'nonexistent12');
        $this->assertNull($project);
    }

    #[Test]
    public function getProjectForAuthReturnsLimitedColumns(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'unlisted', self::validDataJson(), null);

        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertNotNull($project);
        $this->assertSame($id, $project['public_id']);
        $this->assertSame(self::OWNER_HASH, $project['owner_token_hash']);
        $this->assertSame('unlisted', $project['visibility']);
        // Should NOT include data column
        $this->assertArrayNotHasKey('data', $project);
    }

    #[Test]
    public function updateProjectChangesData(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null);

        $newData = json_encode([
            'version' => 1,
            'registers' => [
                ['name' => 'STATUS', 'width' => 16, 'fields' => []],
            ],
            'registerValues' => new \stdClass(),
        ], JSON_UNESCAPED_SLASHES);

        dbUpdateProject(self::$db, $id, $newData, 'unlisted', 'Updated Title');

        $project = dbGetProject(self::$db, $id);
        $this->assertSame('unlisted', $project['visibility']);
        $this->assertStringContainsString('STATUS', $project['data']);
    }

    #[Test]
    public function patchVisibility(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null);

        dbPatchVisibility(self::$db, $id, 'unlisted');

        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertSame('unlisted', $project['visibility']);
    }

    #[Test]
    public function deleteProject(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null);

        dbDeleteProject(self::$db, $id);

        $project = dbGetProject(self::$db, $id);
        $this->assertNull($project);
    }

    #[Test]
    public function listProjectsByOwner(): void
    {
        $id1 = generatePublicId();
        $id2 = generatePublicId();

        dbCreateProject(self::$db, $id1, self::OWNER_HASH, 'private', self::validDataJson(), null);
        dbCreateProject(self::$db, $id2, self::OWNER_HASH, 'unlisted', self::validDataJson(), null);
        // Different owner — should not appear
        dbCreateProject(self::$db, generatePublicId(), self::OTHER_HASH, 'private', self::validDataJson(), null);

        $projects = dbListProjectsByOwner(self::$db, self::OWNER_HASH);
        $this->assertCount(2, $projects);

        $ids = array_column($projects, 'public_id');
        $this->assertContains($id1, $ids);
        $this->assertContains($id2, $ids);
    }

    #[Test]
    public function listProjectsReturnsIsoTimestamps(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null);

        $projects = dbListProjectsByOwner(self::$db, self::OWNER_HASH);
        $this->assertCount(1, $projects);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $projects[0]['created_at_iso']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $projects[0]['updated_at_iso']);
    }

    #[Test]
    public function getProjectTimestamps(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null);

        $timestamps = dbGetProjectTimestamps(self::$db, $id);
        $this->assertNotNull($timestamps);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $timestamps['created_at_iso']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $timestamps['updated_at_iso']);
    }

    #[Test]
    public function duplicatePublicIdThrowsException(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null);

        $this->expectException(\PDOException::class);
        dbCreateProject(self::$db, $id, self::OTHER_HASH, 'private', self::validDataJson(), null);
    }

    #[Test]
    public function isOwnerIntegration(): void
    {
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null);

        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertTrue(isOwner(self::OWNER_HASH, $project));
        $this->assertFalse(isOwner(self::OTHER_HASH, $project));
    }

    #[Test]
    public function storedDataPreservesEmptyObject(): void
    {
        $id = generatePublicId();
        $dataJson = '{"version":1,"registers":[{"name":"R","width":8,"fields":[]}],"registerValues":{}}';
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', $dataJson, null);

        $project = dbGetProject(self::$db, $id);
        $this->assertStringContainsString('"registerValues":{}', $project['data']);
    }
}
