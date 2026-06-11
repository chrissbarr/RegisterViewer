<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class ProjectMetaApiTest extends TestCase
{
    private static ?PDO $db = null;

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
        date_default_timezone_set('UTC');
        self::$db->exec("SET SESSION time_zone = '+00:00'");
        self::$db->exec('DELETE FROM projects');
        self::$db->exec('DELETE FROM users');
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
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
    private function createTestUser(string $email = 'meta-test@example.com'): int
    {
        return dbCreateUser(self::$db, $email);
    }

    /** Helper: decode an ApiResponse body regardless of body/rawJson emission. */
    private function decodeBody(ApiResponse $response): array
    {
        if ($response->rawJson !== null) {
            return json_decode($response->rawJson, true);
        }
        return $response->body ?? [];
    }

    #[Test]
    public function ownerGetsPrivateProjectMetaWithoutData(): void
    {
        $userId = $this->createTestUser('meta-owner@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'meta-owner@example.com'];
        $response = handleGetProjectMeta(self::$db, $id, $auth);

        $this->assertSame(200, $response->status);
        $body = $this->decodeBody($response);
        $this->assertSame($id, $body['id']);
        $this->assertSame(1, $body['version']);
        $this->assertSame('private', $body['visibility']);
        $this->assertTrue($body['isOwner']);
        $this->assertTrue($body['authenticated']);
        $this->assertArrayHasKey('createdAt', $body);
        $this->assertArrayHasKey('updatedAt', $body);
        // The whole point of the probe: no data payload.
        $this->assertArrayNotHasKey('data', $body);
    }

    #[Test]
    public function anonymousGetsUnlistedProjectMeta(): void
    {
        $userId = $this->createTestUser('meta-anon-unlisted@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'unlisted', self::validDataJson(), null, $userId);

        $response = handleGetProjectMeta(self::$db, $id, ['kind' => 'none']);

        $this->assertSame(200, $response->status);
        $body = $this->decodeBody($response);
        $this->assertSame('unlisted', $body['visibility']);
        $this->assertFalse($body['isOwner']);
        $this->assertFalse($body['authenticated']);
        $this->assertArrayNotHasKey('data', $body);
    }

    // ---- Uniform-404 parity with the full GET (IDOR semantics must not diverge) ----

    #[Test]
    public function anonymousPrivate404IsByteIdenticalToFullGetAndMissingProject404(): void
    {
        $userId = $this->createTestUser('meta-parity@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $metaPrivate = handleGetProjectMeta(self::$db, $id, ['kind' => 'none']);
        $fullPrivate = handleGetProject(self::$db, $id, ['kind' => 'none']);
        $metaMissing = handleGetProjectMeta(self::$db, 'nonexistent12', ['kind' => 'none']);
        $fullMissing = handleGetProject(self::$db, 'nonexistent12', ['kind' => 'none']);

        foreach ([$metaPrivate, $fullPrivate, $metaMissing, $fullMissing] as $response) {
            $this->assertSame(404, $response->status);
            $this->assertNull($response->rawJson);
        }
        // Byte-identical bodies: private-not-owner and missing must be
        // indistinguishable, and identical between the meta and full GET.
        $this->assertSame($fullPrivate->body, $metaPrivate->body);
        $this->assertSame($fullMissing->body, $metaMissing->body);
        $this->assertSame($metaMissing->body, $metaPrivate->body);
    }

    #[Test]
    public function nonOwnerOnPrivateProjectGets404(): void
    {
        $ownerId = $this->createTestUser('meta-real-owner@example.com');
        $otherId = $this->createTestUser('meta-other-user@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $ownerId);

        $auth = ['kind' => 'jwt', 'userId' => $otherId, 'email' => 'meta-other-user@example.com'];
        $metaResponse = handleGetProjectMeta(self::$db, $id, $auth);
        $fullResponse = handleGetProject(self::$db, $id, $auth);

        $this->assertSame(404, $metaResponse->status);
        $this->assertSame($fullResponse->status, $metaResponse->status);
        $this->assertSame($fullResponse->body, $metaResponse->body);
    }

    #[Test]
    public function versionReflectsVersionedUpdates(): void
    {
        $userId = $this->createTestUser('meta-version@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $result = dbUpdateProjectVersioned(self::$db, $id, self::validDataJson(), null, 1, $userId);
        $this->assertTrue($result['updated']);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'meta-version@example.com'];
        $response = handleGetProjectMeta(self::$db, $id, $auth);

        $this->assertSame(200, $response->status);
        $body = $this->decodeBody($response);
        $this->assertSame(2, $body['version']);
    }

    #[Test]
    public function touchesLastAccessedAt(): void
    {
        $userId = $this->createTestUser('meta-touch@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'unlisted', self::validDataJson(), null, $userId);

        // Backdate last_accessed_at past the 24h touch threshold.
        $oldLastAccessedAt = utcDbDateTime(time() - 2 * 24 * 60 * 60);
        $stmt = self::$db->prepare(
            'UPDATE projects SET last_accessed_at = :last_accessed_at WHERE public_id = :public_id'
        );
        $stmt->execute(['public_id' => $id, 'last_accessed_at' => $oldLastAccessedAt]);

        $beforeTouch = time();
        $response = handleGetProjectMeta(self::$db, $id, ['kind' => 'none']);
        $afterTouch = time();

        $this->assertSame(200, $response->status);
        $stmt = self::$db->prepare(
            'SELECT last_accessed_at FROM projects WHERE public_id = :public_id'
        );
        $stmt->execute(['public_id' => $id]);
        $touched = $stmt->fetch();
        $lastAccessedAt = parseUtcDbDateTime((string) $touched['last_accessed_at']);
        $this->assertNotNull($lastAccessedAt);
        $this->assertGreaterThanOrEqual($beforeTouch, $lastAccessedAt);
        $this->assertLessThanOrEqual($afterTouch, $lastAccessedAt);
    }

    #[Test]
    public function alwaysSendsPrivateNoStoreCacheControl(): void
    {
        $userId = $this->createTestUser('meta-cache@example.com');
        $privateId = generatePublicId();
        $unlistedId = generatePublicId();
        dbCreateProject(self::$db, $privateId, 'private', self::validDataJson(), null, $userId);
        dbCreateProject(self::$db, $unlistedId, 'unlisted', self::validDataJson(), null, $userId);

        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'meta-cache@example.com'];
        $privateResponse = handleGetProjectMeta(self::$db, $privateId, $auth);
        // A freshness probe must never be served stale — even for non-private
        // projects (the full GET serves unlisted with max-age=60; the probe must not).
        $unlistedResponse = handleGetProjectMeta(self::$db, $unlistedId, ['kind' => 'none']);

        $this->assertSame('private, no-store', $privateResponse->headers['Cache-Control']);
        $this->assertSame('private, no-store', $unlistedResponse->headers['Cache-Control']);
    }

    #[Test]
    public function varyHeaderIncludesOriginAndAuthorization(): void
    {
        $userId = $this->createTestUser('meta-vary@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'unlisted', self::validDataJson(), null, $userId);

        $response = handleGetProjectMeta(self::$db, $id, ['kind' => 'none']);

        $this->assertSame(200, $response->status);
        $this->assertArrayHasKey('Vary', $response->headers);
        $this->assertStringContainsString('Origin', $response->headers['Vary']);
        $this->assertStringContainsString('Authorization', $response->headers['Vary']);
    }

    #[Test]
    public function dispatchRoutesMetaGet(): void
    {
        $userId = $this->createTestUser('meta-dispatch@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'unlisted', self::validDataJson(), null, $userId);

        $config = ['jwt_secret' => 'test-jwt-secret-not-for-production'];
        $response = dispatchApiRoute(
            self::$db,
            $config,
            'GET',
            normalizeApiPath("/api/projects/$id/meta"),
            ['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => "/api/projects/$id/meta"],
        );

        $this->assertSame(200, $response->status);
        $body = $this->decodeBody($response);
        $this->assertSame($id, $body['id']);
        $this->assertArrayNotHasKey('data', $body);
    }
}
