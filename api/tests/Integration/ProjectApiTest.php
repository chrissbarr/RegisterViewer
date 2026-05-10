<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\Attributes\DataProvider;

final class ProjectApiTest extends TestCase
{
    private static ?PDO $db = null;

    private const JWT_CONFIG = ['jwt_secret' => 'test-jwt-secret-not-for-production'];

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
        self::$db->exec('DELETE FROM projects');
        self::$db->exec('DELETE FROM users');
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$db !== null) {
            self::$db->exec('DELETE FROM projects');
            self::$db->exec('DELETE FROM users');
            self::$db = null;
        }
    }

    /** Helper: create a test user and return the user ID. */
    private function createTestUser(string $email = 'test@example.com'): int
    {
        return dbCreateUser(self::$db, $email);
    }

    #[Test]
    public function createAndGetProject(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $project = dbGetProject(self::$db, $id);
        $this->assertNotNull($project);
        $this->assertSame($id, $project['public_id']);
        $this->assertSame('private', $project['visibility']);
        $this->assertNotEmpty($project['data']);
        $this->assertSame($userId, (int) $project['user_id']);
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
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'unlisted', self::validDataJson(), null, $userId);

        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertNotNull($project);
        $this->assertSame($id, $project['public_id']);
        $this->assertSame('unlisted', $project['visibility']);
        $this->assertSame($userId, (int) $project['user_id']);
        // Should NOT include data column
        $this->assertArrayNotHasKey('data', $project);
    }

    #[Test]
    public function updateProjectChangesDataAndPreservesVisibility(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'unlisted', self::validDataJson(), null, $userId);

        $newData = json_encode([
            'version' => 1,
            'registers' => [
                ['name' => 'STATUS', 'width' => 16, 'fields' => []],
            ],
            'registerValues' => new \stdClass(),
        ], JSON_UNESCAPED_SLASHES);

        dbUpdateProject(self::$db, $id, $newData, 'Updated Title');

        $project = dbGetProject(self::$db, $id);
        $this->assertSame('unlisted', $project['visibility']);
        $this->assertStringContainsString('STATUS', $project['data']);
    }

    #[Test]
    public function patchVisibility(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        dbPatchVisibility(self::$db, $id, 'unlisted');

        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertSame('unlisted', $project['visibility']);
    }

    #[Test]
    public function deleteProject(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        dbDeleteProject(self::$db, $id);

        $project = dbGetProject(self::$db, $id);
        $this->assertNull($project);
    }

    #[Test]
    public function getProjectTimestamps(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $timestamps = dbGetProjectTimestamps(self::$db, $id);
        $this->assertNotNull($timestamps);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $timestamps['created_at_iso']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $timestamps['updated_at_iso']);
    }

    #[Test]
    public function duplicatePublicIdThrowsException(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $this->expectException(\PDOException::class);
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);
    }

    #[Test]
    public function storedDataPreservesEmptyObject(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        $dataJson = '{"version":1,"registers":[{"name":"R","width":8,"fields":[]}],"registerValues":{}}';
        dbCreateProject(self::$db, $id, 'private', $dataJson, null, $userId);

        $project = dbGetProject(self::$db, $id);
        $this->assertStringContainsString('"registerValues":{}', $project['data']);
    }

    #[Test]
    public function handleGetProjectIncludesVisibility(): void
    {
        $userId = $this->createTestUser('get-visibility@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'unlisted', self::validDataJson(), null, $userId);

        $response = handleGetProject(self::$db, $id, ['kind' => 'none']);

        $this->assertSame(200, $response->status);
        $body = json_decode($response->rawJson ?? '', true);
        $this->assertSame('unlisted', $body['visibility']);
        $this->assertFalse($body['isOwner']);
    }

    #[Test]
    public function countProjectsByUserIdReturnsCorrectCount(): void
    {
        $userId = $this->createTestUser('counter@example.com');

        for ($i = 0; $i < 3; $i++) {
            dbCreateProject(self::$db, generatePublicId(), 'private', self::validDataJson(), null, $userId);
        }

        // Create 1 project under a different user
        $otherUserId = $this->createTestUser('other@example.com');
        dbCreateProject(self::$db, generatePublicId(), 'private', self::validDataJson(), null, $otherUserId);

        $this->assertSame(3, dbCountProjectsByUserId(self::$db, $userId));
        $this->assertSame(1, dbCountProjectsByUserId(self::$db, $otherUserId));
    }

    #[Test]
    public function countProjectsByUserIdReturnsZeroForUnknownUser(): void
    {
        $this->assertSame(0, dbCountProjectsByUserId(self::$db, 999999));
    }

    #[Test]
    public function createProjectEnforcesPerUserLimit(): void
    {
        $userId = $this->createTestUser('limittest@example.com');

        for ($i = 0; $i < LIMITS['MAX_PROJECTS_PER_USER']; $i++) {
            dbCreateProject(self::$db, generatePublicId(), 'private', self::validDataJson(), null, $userId);
        }

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'limittest@example.com'];
        $body = [
            'data' => json_decode(self::validDataJson(), true),
        ];
        $parsed = [
            'assoc'  => $body,
            'object' => json_decode(json_encode($body)),
        ];
        $config = ['app_url' => 'http://localhost'];

        $response = handleCreateProject(self::$db, $config, $auth, $parsed);

        $this->assertSame(429, $response->status);
        $this->assertStringContainsString('Project limit reached', $response->body['error']);
    }

    // ---- Handler 401 tests (no auth) ----

    #[Test]
    public function handleCreateProjectReturns401WhenAuthKindIsNone(): void
    {
        $auth = ['kind' => 'none'];
        $body = ['data' => json_decode(self::validDataJson(), true)];
        $parsed = [
            'assoc'  => $body,
            'object' => json_decode(json_encode($body)),
        ];
        $config = ['app_url' => 'http://localhost'];

        $response = handleCreateProject(self::$db, $config, $auth, $parsed);

        $this->assertSame(401, $response->status);
        $this->assertSame('Authentication required', $response->body['error']);
    }

    #[Test]
    public function handleListProjectsReturns401WhenAuthKindIsNone(): void
    {
        $auth = ['kind' => 'none'];

        $response = handleListProjects(self::$db, $auth);

        $this->assertSame(401, $response->status);
        $this->assertSame('Authentication required', $response->body['error']);
    }

    // ---- requireOwnership() tests ----

    #[Test]
    public function requireOwnershipReturns401ForNoAuth(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'none'];
        $result = requireOwnership(self::$db, $id, $auth);

        $this->assertInstanceOf(ApiResponse::class, $result);
        $this->assertSame(401, $result->status);
        $this->assertSame('Authentication required', $result->body['error']);
    }

    #[Test]
    public function requireOwnershipReturns404ForNonexistentProject(): void
    {
        $auth = ['kind' => 'jwt', 'userId' => 1, 'email' => 'test@example.com'];
        $result = requireOwnership(self::$db, 'nonexistent12', $auth);

        $this->assertInstanceOf(ApiResponse::class, $result);
        $this->assertSame(404, $result->status);
    }

    #[Test]
    public function requireOwnershipReturnsProjectForMatchingJwtUserId(): void
    {
        $userId = $this->createTestUser('owner-jwt@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'owner-jwt@example.com'];
        $result = requireOwnership(self::$db, $id, $auth);

        $this->assertIsArray($result);
        $this->assertSame($id, $result['public_id']);
    }

    #[Test]
    public function requireOwnershipReturns404ForWrongJwtUserId(): void
    {
        $userId = $this->createTestUser('real-owner@example.com');
        $otherId = $this->createTestUser('not-owner@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $otherId, 'email' => 'not-owner@example.com'];
        $result = requireOwnership(self::$db, $id, $auth);

        $this->assertInstanceOf(ApiResponse::class, $result);
        $this->assertSame(404, $result->status);
    }

    // ---- JWT-authenticated handler operations ----

    private function makeParsedBody(
        array $data,
        ?string $visibility = null,
        mixed $version = 1,
        bool $includeVersion = true,
    ): array
    {
        $body = ['data' => $data];
        if ($visibility !== null) {
            $body['visibility'] = $visibility;
        }
        if ($includeVersion) {
            $body['version'] = $version;
        }
        $json = json_encode($body, JSON_UNESCAPED_SLASHES);
        return [
            'assoc'  => json_decode($json, true),
            'object' => json_decode($json),
        ];
    }

    private function updateDataWithRegister(string $name): array
    {
        return [
            'version' => 1,
            'registers' => [['name' => $name, 'width' => 8, 'fields' => []]],
            'registerValues' => new \stdClass(),
        ];
    }

    private function assertProjectStorageUnchanged(
        string $id,
        string $expectedData,
        int $expectedVersion = 1,
        string $expectedVisibility = 'private',
    ): void
    {
        $project = dbGetProject(self::$db, $id);

        $this->assertNotNull($project);
        $this->assertSame($expectedData, $project['data']);
        $this->assertSame($expectedVersion, (int) $project['version']);
        $this->assertSame($expectedVisibility, $project['visibility']);
    }

    #[Test]
    public function handleUpdateProjectWithJwtAuth(): void
    {
        $userId = $this->createTestUser('jwt-update@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'unlisted', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'jwt-update@example.com'];
        $newData = $this->updateDataWithRegister('UPDATED');
        $parsed = $this->makeParsedBody($newData);

        $response = handleUpdateProject(self::$db, $id, $auth, $parsed);

        $this->assertSame(200, $response->status);
        $this->assertSame($id, $response->body['id']);
        $this->assertArrayHasKey('updatedAt', $response->body);
        $this->assertSame(2, $response->body['version']);

        // Verify data was actually updated
        $project = dbGetProject(self::$db, $id);
        $this->assertStringContainsString('UPDATED', $project['data']);
        $this->assertSame(2, (int) $project['version']);
        $this->assertSame('unlisted', $project['visibility']);
    }

    #[Test]
    public function handleUpdateProjectRejectsTopLevelVisibilityWithoutMutation(): void
    {
        $userId = $this->createTestUser('put-visibility@example.com');
        $id = generatePublicId();
        $originalData = self::validDataJson();
        dbCreateProject(self::$db, $id, 'private', $originalData, null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'put-visibility@example.com'];
        $parsed = $this->makeParsedBody(
            $this->updateDataWithRegister('SHOULD_NOT_SAVE'),
            'unlisted',
            1,
        );

        $response = handleUpdateProject(self::$db, $id, $auth, $parsed);

        $this->assertSame(400, $response->status);
        $this->assertSame('visibility cannot be updated via PUT; use PATCH /api/projects/{id}', $response->body['error']);
        $this->assertProjectStorageUnchanged($id, $originalData);
    }

    #[Test]
    public function handleUpdateProjectRejectsNullTopLevelVisibilityWithoutMutation(): void
    {
        $userId = $this->createTestUser('put-null-visibility@example.com');
        $id = generatePublicId();
        $originalData = self::validDataJson();
        dbCreateProject(self::$db, $id, 'private', $originalData, null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'put-null-visibility@example.com'];
        $body = [
            'data'       => $this->updateDataWithRegister('SHOULD_NOT_SAVE_NULL'),
            'visibility' => null,
            'version'    => 1,
        ];
        $json = json_encode($body, JSON_UNESCAPED_SLASHES);
        $parsed = [
            'assoc'  => json_decode($json, true),
            'object' => json_decode($json),
        ];

        $response = handleUpdateProject(self::$db, $id, $auth, $parsed);

        $this->assertSame(400, $response->status);
        $this->assertSame('visibility cannot be updated via PUT; use PATCH /api/projects/{id}', $response->body['error']);
        $this->assertProjectStorageUnchanged($id, $originalData);
    }

    #[Test]
    public function handleUpdateProjectWithVisibilityRejects401ForNoAuth(): void
    {
        $userId = $this->createTestUser('visibility-no-auth-owner@example.com');
        $id = generatePublicId();
        $originalData = self::validDataJson();
        dbCreateProject(self::$db, $id, 'private', $originalData, null, $userId);

        $auth = ['kind' => 'none'];
        $parsed = $this->makeParsedBody(
            $this->updateDataWithRegister('NO_AUTH_SHOULD_NOT_SAVE'),
            'unlisted',
            1,
        );

        $response = handleUpdateProject(self::$db, $id, $auth, $parsed);

        $this->assertSame(401, $response->status);
        $this->assertProjectStorageUnchanged($id, $originalData);
    }

    #[Test]
    public function handleUpdateProjectRejectsMissingTopLevelVersion(): void
    {
        $userId = $this->createTestUser('missing-version@example.com');
        $id = generatePublicId();
        $originalData = self::validDataJson();
        dbCreateProject(self::$db, $id, 'private', $originalData, null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'missing-version@example.com'];
        $parsed = $this->makeParsedBody(
            $this->updateDataWithRegister('MISSING_VERSION'),
            null,
            1,
            false,
        );

        $response = handleUpdateProject(self::$db, $id, $auth, $parsed);

        $this->assertSame(400, $response->status);
        $this->assertSame('version must be a positive integer', $response->body['error']);
        $this->assertProjectStorageUnchanged($id, $originalData);
    }

    #[Test]
    public function handleUpdateProjectRejectsNullTopLevelVersion(): void
    {
        $userId = $this->createTestUser('null-version@example.com');
        $id = generatePublicId();
        $originalData = self::validDataJson();
        dbCreateProject(self::$db, $id, 'private', $originalData, null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'null-version@example.com'];
        $parsed = $this->makeParsedBody(
            $this->updateDataWithRegister('NULL_VERSION'),
            null,
            null,
        );

        $response = handleUpdateProject(self::$db, $id, $auth, $parsed);

        $this->assertSame(400, $response->status);
        $this->assertSame('version must be a positive integer', $response->body['error']);
        $this->assertProjectStorageUnchanged($id, $originalData);
    }

    public static function invalidTopLevelVersionProvider(): array
    {
        return [
            'zero' => [0],
            'negative' => [-1],
            'string' => ['1'],
            'float' => [1.5],
        ];
    }

    #[Test]
    #[DataProvider('invalidTopLevelVersionProvider')]
    public function handleUpdateProjectRejectsInvalidTopLevelVersion(mixed $version): void
    {
        $userId = $this->createTestUser('invalid-version@example.com');
        $id = generatePublicId();
        $originalData = self::validDataJson();
        dbCreateProject(self::$db, $id, 'private', $originalData, null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'invalid-version@example.com'];
        $parsed = $this->makeParsedBody(
            $this->updateDataWithRegister('INVALID_VERSION'),
            null,
            $version,
        );

        $response = handleUpdateProject(self::$db, $id, $auth, $parsed);

        $this->assertSame(400, $response->status);
        $this->assertSame('version must be a positive integer', $response->body['error']);
        $this->assertProjectStorageUnchanged($id, $originalData);
    }

    #[Test]
    public function handleUpdateProjectReturns409ForStaleExplicitVersion(): void
    {
        $userId = $this->createTestUser('stale-version@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'stale-version@example.com'];
        $firstResponse = handleUpdateProject(
            self::$db,
            $id,
            $auth,
            $this->makeParsedBody($this->updateDataWithRegister('VERSION_TWO'), null, 1),
        );
        $this->assertSame(200, $firstResponse->status);

        $patchResponse = handlePatchProject(self::$db, $id, $auth, ['visibility' => 'unlisted']);
        $this->assertSame(200, $patchResponse->status);

        $afterVisibilityPatch = dbGetProject(self::$db, $id);
        $this->assertNotNull($afterVisibilityPatch);
        $this->assertSame('unlisted', $afterVisibilityPatch['visibility']);
        $this->assertSame(2, (int) $afterVisibilityPatch['version']);

        $staleResponse = handleUpdateProject(
            self::$db,
            $id,
            $auth,
            $this->makeParsedBody($this->updateDataWithRegister('STALE_WRITE'), null, 1),
        );

        $this->assertSame(409, $staleResponse->status);
        $this->assertSame('version_conflict', $staleResponse->body['error']);
        $this->assertSame(2, $staleResponse->body['currentVersion']);
        $this->assertProjectStorageUnchanged($id, $afterVisibilityPatch['data'], 2, 'unlisted');
    }

    #[Test]
    public function handleUpdateProjectWithVisibilityRejects404ForWrongJwtUser(): void
    {
        $ownerId = $this->createTestUser('real@example.com');
        $otherId = $this->createTestUser('imposter@example.com');
        $id = generatePublicId();
        $originalData = self::validDataJson();
        dbCreateProject(self::$db, $id, 'private', $originalData, null, $ownerId);

        $auth = ['kind' => 'jwt', 'userId' => $otherId, 'email' => 'imposter@example.com'];
        $parsed = $this->makeParsedBody(
            $this->updateDataWithRegister('WRONG_OWNER'),
            'unlisted',
            1,
        );

        $response = handleUpdateProject(self::$db, $id, $auth, $parsed);

        $this->assertSame(404, $response->status);
        $this->assertProjectStorageUnchanged($id, $originalData);
    }

    #[Test]
    public function handleDeleteProjectWithJwtAuth(): void
    {
        $userId = $this->createTestUser('jwt-delete@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'jwt-delete@example.com'];

        $response = handleDeleteProject(self::$db, $id, $auth);

        $this->assertSame(204, $response->status);
        $this->assertNull(dbGetProject(self::$db, $id));
    }

    #[Test]
    public function handleDeleteProjectRejects404ForWrongJwtUser(): void
    {
        $ownerId = $this->createTestUser('owner@example.com');
        $otherId = $this->createTestUser('stranger@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $ownerId);

        $auth = ['kind' => 'jwt', 'userId' => $otherId, 'email' => 'stranger@example.com'];

        $response = handleDeleteProject(self::$db, $id, $auth);

        $this->assertSame(404, $response->status);
        // Project should still exist
        $this->assertNotNull(dbGetProject(self::$db, $id));
    }

    #[Test]
    public function handlePatchProjectWithJwtAuth(): void
    {
        $userId = $this->createTestUser('jwt-patch@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'jwt-patch@example.com'];

        $response = handlePatchProject(self::$db, $id, $auth, ['visibility' => 'unlisted']);

        $this->assertSame(200, $response->status);
        $this->assertSame($id, $response->body['id']);

        // Verify visibility was changed
        $project = dbGetProject(self::$db, $id);
        $this->assertSame('unlisted', $project['visibility']);
        $this->assertSame(1, (int) $project['version']);
    }

    #[Test]
    public function handlePatchThenMatchingVersionUpdatePreservesPatchedVisibility(): void
    {
        $userId = $this->createTestUser('patch-then-put@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'patch-then-put@example.com'];

        $patchResponse = handlePatchProject(self::$db, $id, $auth, ['visibility' => 'unlisted']);
        $this->assertSame(200, $patchResponse->status);

        $afterPatch = dbGetProject(self::$db, $id);
        $this->assertNotNull($afterPatch);
        $this->assertSame('unlisted', $afterPatch['visibility']);
        $this->assertSame(1, (int) $afterPatch['version']);

        $putResponse = handleUpdateProject(
            self::$db,
            $id,
            $auth,
            $this->makeParsedBody($this->updateDataWithRegister('AFTER_PATCH'), null, 1),
        );

        $this->assertSame(200, $putResponse->status);
        $this->assertSame(2, $putResponse->body['version']);

        $project = dbGetProject(self::$db, $id);
        $this->assertStringContainsString('AFTER_PATCH', $project['data']);
        $this->assertSame('unlisted', $project['visibility']);
        $this->assertSame(2, (int) $project['version']);
    }

    #[Test]
    public function handlePatchProjectRejects404ForWrongJwtUser(): void
    {
        $ownerId = $this->createTestUser('patchowner@example.com');
        $otherId = $this->createTestUser('patchother@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $ownerId);

        $auth = ['kind' => 'jwt', 'userId' => $otherId, 'email' => 'patchother@example.com'];

        $response = handlePatchProject(self::$db, $id, $auth, ['visibility' => 'unlisted']);

        $this->assertSame(404, $response->status);
        // Visibility should remain unchanged
        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertSame('private', $project['visibility']);
    }

    #[Test]
    public function handleListProjectsWithJwtAuth(): void
    {
        $userId = $this->createTestUser('jwt-list@example.com');
        $id1 = generatePublicId();
        $id2 = generatePublicId();
        dbCreateProject(self::$db, $id1, 'private', self::validDataJson(), null, $userId);
        dbCreateProject(self::$db, $id2, 'unlisted', self::validDataJson(), null, $userId);
        // Another user's project — should not appear
        $otherUserId = $this->createTestUser('other-list@example.com');
        dbCreateProject(self::$db, generatePublicId(), 'private', self::validDataJson(), null, $otherUserId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'jwt-list@example.com'];
        $response = handleListProjects(self::$db, $auth);

        $this->assertSame(200, $response->status);
        $this->assertCount(2, $response->body['projects']);
        $ids = array_column($response->body['projects'], 'id');
        $this->assertContains($id1, $ids);
        $this->assertContains($id2, $ids);
    }

    #[Test]
    public function handleListProjectsReturnsIsoTimestamps(): void
    {
        $userId = $this->createTestUser();
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'test@example.com'];
        $response = handleListProjects(self::$db, $auth);

        $this->assertSame(200, $response->status);
        $this->assertCount(1, $response->body['projects']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $response->body['projects'][0]['createdAt']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $response->body['projects'][0]['updatedAt']);
    }
}
