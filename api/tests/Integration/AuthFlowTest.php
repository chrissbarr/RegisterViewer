<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class AuthFlowTest extends TestCase
{
    private static ?PDO $db = null;
    private const JWT_CONFIG = ['jwt_secret' => 'test-jwt-secret-not-for-production'];
    private const OWNER_HASH = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';

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
        // Clean tables before each test (order matters due to FK)
        self::$db->exec('DELETE FROM projects');
        self::$db->exec('DELETE FROM login_codes');
        self::$db->exec('DELETE FROM users');
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$db !== null) {
            self::$db->exec('DELETE FROM projects');
            self::$db->exec('DELETE FROM login_codes');
            self::$db->exec('DELETE FROM users');
            self::$db = null;
        }
    }

    // ---- User CRUD ----

    #[Test]
    public function createAndGetUser(): void
    {
        $userId = dbCreateUser(self::$db, 'test@example.com');
        $this->assertGreaterThan(0, $userId);

        $user = dbGetUserByEmail(self::$db, 'test@example.com');
        $this->assertNotNull($user);
        $this->assertSame($userId, (int) $user['id']);
        $this->assertSame('test@example.com', $user['email']);
    }

    #[Test]
    public function getUserByIdWorks(): void
    {
        $userId = dbCreateUser(self::$db, 'byid@example.com');
        $user = dbGetUserById(self::$db, $userId);
        $this->assertNotNull($user);
        $this->assertSame('byid@example.com', $user['email']);
    }

    #[Test]
    public function getUserByEmailReturnsNullForUnknown(): void
    {
        $this->assertNull(dbGetUserByEmail(self::$db, 'nobody@example.com'));
    }

    #[Test]
    public function getUserByIdReturnsNullForUnknown(): void
    {
        $this->assertNull(dbGetUserById(self::$db, 999999));
    }

    // ---- Login Codes ----

    #[Test]
    public function createAndGetLoginCode(): void
    {
        $email = 'otp@example.com';
        $codeHash = hash('sha256', '123456');
        $expiresAt = gmdate('Y-m-d H:i:s', time() + 600);

        dbCreateLoginCode(self::$db, $email, $codeHash, $expiresAt);

        $row = dbGetActiveLoginCode(self::$db, $email, $codeHash);
        $this->assertNotNull($row);
        $this->assertSame($email, $row['email']);
        $this->assertSame($codeHash, $row['code']);
        $this->assertSame(0, (int) $row['attempts']);
    }

    #[Test]
    public function getActiveLoginCodeReturnsNullForWrongCode(): void
    {
        $email = 'otp@example.com';
        dbCreateLoginCode(self::$db, $email, hash('sha256', '123456'), gmdate('Y-m-d H:i:s', time() + 600));

        $row = dbGetActiveLoginCode(self::$db, $email, hash('sha256', '999999'));
        $this->assertNull($row);
    }

    #[Test]
    public function getActiveLoginCodeReturnsNullForExpiredCode(): void
    {
        $email = 'otp@example.com';
        dbCreateLoginCode(self::$db, $email, hash('sha256', '123456'), gmdate('Y-m-d H:i:s', time() - 1));

        $row = dbGetActiveLoginCode(self::$db, $email, hash('sha256', '123456'));
        $this->assertNull($row);
    }

    #[Test]
    public function getActiveLoginCodeReturnsNullForUsedCode(): void
    {
        $email = 'otp@example.com';
        $codeHash = hash('sha256', '123456');
        dbCreateLoginCode(self::$db, $email, $codeHash, gmdate('Y-m-d H:i:s', time() + 600));

        $row = dbGetActiveLoginCode(self::$db, $email, $codeHash);
        dbMarkLoginCodeUsed(self::$db, (int) $row['id']);

        $row2 = dbGetActiveLoginCode(self::$db, $email, $codeHash);
        $this->assertNull($row2);
    }

    #[Test]
    public function incrementLoginCodeAttempts(): void
    {
        $email = 'otp@example.com';
        $codeHash = hash('sha256', '123456');
        dbCreateLoginCode(self::$db, $email, $codeHash, gmdate('Y-m-d H:i:s', time() + 600));

        $row = dbGetActiveLoginCode(self::$db, $email, $codeHash);
        $this->assertSame(0, (int) $row['attempts']);

        dbIncrementLoginCodeAttempts(self::$db, (int) $row['id']);
        $row2 = dbGetActiveLoginCode(self::$db, $email, $codeHash);
        $this->assertSame(1, (int) $row2['attempts']);
    }

    #[Test]
    public function getActiveLoginCodeReturnsNullAfterFiveAttempts(): void
    {
        $email = 'otp@example.com';
        $codeHash = hash('sha256', '123456');
        dbCreateLoginCode(self::$db, $email, $codeHash, gmdate('Y-m-d H:i:s', time() + 600));

        $row = dbGetActiveLoginCode(self::$db, $email, $codeHash);
        for ($i = 0; $i < 5; $i++) {
            dbIncrementLoginCodeAttempts(self::$db, (int) $row['id']);
        }

        $row2 = dbGetActiveLoginCode(self::$db, $email, $codeHash);
        $this->assertNull($row2);
    }

    #[Test]
    public function countRecentLoginCodes(): void
    {
        $email = 'rate@example.com';
        $this->assertSame(0, dbCountRecentLoginCodes(self::$db, $email));

        dbCreateLoginCode(self::$db, $email, hash('sha256', '111111'), gmdate('Y-m-d H:i:s', time() + 600));
        dbCreateLoginCode(self::$db, $email, hash('sha256', '222222'), gmdate('Y-m-d H:i:s', time() + 600));
        $this->assertSame(2, dbCountRecentLoginCodes(self::$db, $email));

        // Other email should not count
        dbCreateLoginCode(self::$db, 'other@example.com', hash('sha256', '333333'), gmdate('Y-m-d H:i:s', time() + 600));
        $this->assertSame(2, dbCountRecentLoginCodes(self::$db, $email));
    }

    // ---- Project Linking ----

    #[Test]
    public function linkProjectsByOwnerToken(): void
    {
        $id1 = generatePublicId();
        $id2 = generatePublicId();
        dbCreateProject(self::$db, $id1, self::OWNER_HASH, 'private', self::validDataJson(), null);
        dbCreateProject(self::$db, $id2, self::OWNER_HASH, 'private', self::validDataJson(), null);

        // Verify no user_id initially
        $p1 = dbGetProjectForAuth(self::$db, $id1);
        $this->assertNull($p1['user_id']);

        // Create user and link
        $userId = dbCreateUser(self::$db, 'linker@example.com');
        $linked = dbLinkProjectsByOwnerToken(self::$db, self::OWNER_HASH, $userId);
        $this->assertSame(2, $linked);

        // Verify user_id is set
        $p1After = dbGetProjectForAuth(self::$db, $id1);
        $this->assertSame($userId, (int) $p1After['user_id']);
    }

    #[Test]
    public function linkProjectsSkipsAlreadyLinked(): void
    {
        $userId1 = dbCreateUser(self::$db, 'first@example.com');
        $userId2 = dbCreateUser(self::$db, 'second@example.com');

        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null, $userId1);

        // Linking with a different user should not overwrite
        $linked = dbLinkProjectsByOwnerToken(self::$db, self::OWNER_HASH, $userId2);
        $this->assertSame(0, $linked);

        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertSame($userId1, (int) $project['user_id']);
    }

    // ---- List by User ID ----

    #[Test]
    public function listProjectsByUserId(): void
    {
        $userId = dbCreateUser(self::$db, 'lister@example.com');
        $id1 = generatePublicId();
        $id2 = generatePublicId();
        dbCreateProject(self::$db, $id1, self::OWNER_HASH, 'private', self::validDataJson(), null, $userId);
        dbCreateProject(self::$db, $id2, self::OWNER_HASH, 'unlisted', self::validDataJson(), null, $userId);

        // Different user's project should not appear
        $otherUser = dbCreateUser(self::$db, 'other@example.com');
        $id3 = generatePublicId();
        dbCreateProject(self::$db, $id3, 'bb' . str_repeat('00', 31), 'private', self::validDataJson(), null, $otherUser);

        $projects = dbListProjectsByUserId(self::$db, $userId);
        $this->assertCount(2, $projects);

        $ids = array_column($projects, 'public_id');
        $this->assertContains($id1, $ids);
        $this->assertContains($id2, $ids);
    }

    // ---- JWT Integration ----

    #[Test]
    public function createProjectWithUserId(): void
    {
        $userId = dbCreateUser(self::$db, 'creator@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null, $userId);

        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertSame($userId, (int) $project['user_id']);
    }

    #[Test]
    public function ownershipViaUserIdWorks(): void
    {
        $userId = dbCreateUser(self::$db, 'owner@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, self::OWNER_HASH, 'private', self::validDataJson(), null, $userId);

        $project = dbGetProjectForAuth(self::$db, $id);

        // JWT auth should match
        $jwtAuth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'owner@example.com'];
        $this->assertTrue(isOwnerOrUser($jwtAuth, $project));

        // Token auth should also match
        $tokenAuth = ['kind' => 'token', 'tokenHash' => self::OWNER_HASH];
        $this->assertTrue(isOwnerOrUser($tokenAuth, $project));

        // Wrong user should not match
        $wrongAuth = ['kind' => 'jwt', 'userId' => 999, 'email' => 'wrong@example.com'];
        $this->assertFalse(isOwnerOrUser($wrongAuth, $project));
    }
}
