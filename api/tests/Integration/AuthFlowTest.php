<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class AuthFlowTest extends TestCase
{
    private static ?PDO $db = null;
    private const JWT_CONFIG = [
        'jwt_secret' => 'test-jwt-secret-not-for-production',
        'otp_hash_secret' => 'test-otp-hash-secret-not-for-production',
    ];

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

    private function codeVerifier(string $email, string $code): string
    {
        return createOtpVerifier(self::JWT_CONFIG, $email, $code);
    }

    private function latestLoginCodeRow(string $email): ?array
    {
        $stmt = self::$db->prepare(
            'SELECT id, email, code_verifier, expires_at, attempts, used
             FROM login_codes
             WHERE email = :email
             ORDER BY created_at DESC, id DESC
             LIMIT 1'
        );
        $stmt->execute(['email' => $email]);
        $row = $stmt->fetch();
        return $row ?: null;
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
        self::$db->exec('DELETE FROM auth_rate_limits');
        self::$db->exec('DELETE FROM login_codes');
        self::$db->exec('DELETE FROM users');
        self::$db->exec('DELETE FROM revoked_tokens');
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$db !== null) {
            self::$db->exec('DELETE FROM projects');
            self::$db->exec('DELETE FROM auth_rate_limits');
            self::$db->exec('DELETE FROM login_codes');
            self::$db->exec('DELETE FROM users');
            self::$db->exec('DELETE FROM revoked_tokens');
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
        $codeVerifier = $this->codeVerifier($email, '123456');
        $expiresAt = gmdate('Y-m-d H:i:s', time() + 600);

        dbCreateLoginCode(self::$db, $email, $codeVerifier, $expiresAt);

        $row = $this->latestLoginCodeRow($email);
        $this->assertNotNull($row);
        $this->assertSame($email, $row['email']);
        $this->assertSame($codeVerifier, $row['code_verifier']);
        $this->assertSame(0, (int) $row['attempts']);
    }

    #[Test]
    public function latestLoginCodeReturnsMostRecentCode(): void
    {
        $email = 'otp@example.com';
        dbCreateLoginCode(self::$db, $email, $this->codeVerifier($email, '123456'), gmdate('Y-m-d H:i:s', time() + 600));
        dbCreateLoginCode(self::$db, $email, $this->codeVerifier($email, '654321'), gmdate('Y-m-d H:i:s', time() + 600));

        self::$db->beginTransaction();
        try {
            $row = dbGetLatestLoginCodeForUpdate(self::$db, $email);
            $this->assertNotNull($row);
            $this->assertSame($this->codeVerifier($email, '654321'), $row['code_verifier']);
        } finally {
            self::$db->rollBack();
        }
    }

    #[Test]
    public function latestLoginCodeReturnsExpiredCodeForHandlerDecision(): void
    {
        $email = 'otp@example.com';
        dbCreateLoginCode(self::$db, $email, $this->codeVerifier($email, '123456'), gmdate('Y-m-d H:i:s', time() - 1));

        $row = $this->latestLoginCodeRow($email);
        $this->assertNotNull($row);
        $this->assertLessThanOrEqual(time(), strtotime((string) $row['expires_at']));
    }

    #[Test]
    public function markLoginCodeUsedSetsUsedFlag(): void
    {
        $email = 'otp@example.com';
        dbCreateLoginCode(self::$db, $email, $this->codeVerifier($email, '123456'), gmdate('Y-m-d H:i:s', time() + 600));

        $row = $this->latestLoginCodeRow($email);
        dbMarkLoginCodeUsed(self::$db, (int) $row['id']);

        $row2 = $this->latestLoginCodeRow($email);
        $this->assertSame(1, (int) $row2['used']);
    }

    #[Test]
    public function incrementLoginCodeAttempts(): void
    {
        $email = 'otp@example.com';
        dbCreateLoginCode(self::$db, $email, $this->codeVerifier($email, '123456'), gmdate('Y-m-d H:i:s', time() + 600));

        $row = $this->latestLoginCodeRow($email);
        $this->assertSame(0, (int) $row['attempts']);

        dbIncrementLoginCodeAttempts(self::$db, (int) $row['id']);
        $row2 = $this->latestLoginCodeRow($email);
        $this->assertSame(1, (int) $row2['attempts']);
    }

    #[Test]
    public function loginCodeAttemptsCanReachPerCodeLimit(): void
    {
        $email = 'otp@example.com';
        dbCreateLoginCode(self::$db, $email, $this->codeVerifier($email, '123456'), gmdate('Y-m-d H:i:s', time() + 600));

        $row = $this->latestLoginCodeRow($email);
        for ($i = 0; $i < 5; $i++) {
            dbIncrementLoginCodeAttempts(self::$db, (int) $row['id']);
        }

        $row2 = $this->latestLoginCodeRow($email);
        $this->assertSame(5, (int) $row2['attempts']);
    }

    #[Test]
    public function countRecentLoginCodes(): void
    {
        $email = 'rate@example.com';
        $this->assertSame(0, dbCountRecentLoginCodes(self::$db, $email));

        dbCreateLoginCode(self::$db, $email, $this->codeVerifier($email, '111111'), gmdate('Y-m-d H:i:s', time() + 600));
        dbCreateLoginCode(self::$db, $email, $this->codeVerifier($email, '222222'), gmdate('Y-m-d H:i:s', time() + 600));
        $this->assertSame(2, dbCountRecentLoginCodes(self::$db, $email));

        // Other email should not count
        dbCreateLoginCode(
            self::$db,
            'other@example.com',
            $this->codeVerifier('other@example.com', '333333'),
            gmdate('Y-m-d H:i:s', time() + 600)
        );
        $this->assertSame(2, dbCountRecentLoginCodes(self::$db, $email));
    }

    // ---- List by User ID ----

    #[Test]
    public function listProjectsByUserId(): void
    {
        $userId = dbCreateUser(self::$db, 'lister@example.com');
        $id1 = generatePublicId();
        $id2 = generatePublicId();
        dbCreateProject(self::$db, $id1, 'private', self::validDataJson(), null, $userId);
        dbCreateProject(self::$db, $id2, 'unlisted', self::validDataJson(), null, $userId);

        // Different user's project should not appear
        $otherUser = dbCreateUser(self::$db, 'other@example.com');
        $id3 = generatePublicId();
        dbCreateProject(self::$db, $id3, 'private', self::validDataJson(), null, $otherUser);

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
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $project = dbGetProjectForAuth(self::$db, $id);
        $this->assertSame($userId, (int) $project['user_id']);
    }

    #[Test]
    public function ownershipViaUserIdWorks(): void
    {
        $userId = dbCreateUser(self::$db, 'owner@example.com');
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', self::validDataJson(), null, $userId);

        $project = dbGetProjectForAuth(self::$db, $id);

        // JWT auth should match
        $jwtAuth = ['kind' => 'jwt', 'userId' => $userId, 'email' => 'owner@example.com'];
        $this->assertTrue(isProjectOwner($jwtAuth, $project));

        // Wrong user should not match
        $wrongAuth = ['kind' => 'jwt', 'userId' => 999, 'email' => 'wrong@example.com'];
        $this->assertFalse(isProjectOwner($wrongAuth, $project));
    }
}
