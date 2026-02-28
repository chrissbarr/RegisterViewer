<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class AuthHandlerTest extends TestCase
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

    /**
     * Create a login code in the DB and return the code string.
     */
    private function createLoginCode(string $email, string $code = '123456', int $ttlSeconds = 600): string
    {
        $expiresAt = gmdate('Y-m-d H:i:s', time() + $ttlSeconds);
        dbCreateLoginCode(self::$db, $email, $code, $expiresAt);
        return $code;
    }

    // ---- handleAuthSendCode ----

    #[Test]
    public function sendCodeReturnsOkForValidEmail(): void
    {
        $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, [
            'email' => 'test@example.com',
        ]);

        $this->assertSame(200, $response->status);
        $this->assertTrue($response->body['ok']);

        // Verify a login code was created in the DB
        $count = dbCountRecentLoginCodes(self::$db, 'test@example.com');
        $this->assertSame(1, $count);
    }

    #[Test]
    public function sendCodeRejectsMissingEmail(): void
    {
        $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, []);

        $this->assertSame(400, $response->status);
        $this->assertSame('email is required', $response->body['error']);
    }

    #[Test]
    public function sendCodeRejectsInvalidEmail(): void
    {
        $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, [
            'email' => 'not-an-email',
        ]);

        $this->assertSame(400, $response->status);
        $this->assertSame('Invalid email address', $response->body['error']);
    }

    #[Test]
    public function sendCodeEnforcesRateLimit(): void
    {
        $email = 'ratelimit@example.com';

        // Send 3 codes (the limit)
        for ($i = 0; $i < 3; $i++) {
            $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, ['email' => $email]);
            $this->assertSame(200, $response->status);
        }

        // 4th should be rate-limited
        $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, ['email' => $email]);
        $this->assertSame(429, $response->status);
        $this->assertStringContainsString('Too many', $response->body['error']);
    }

    #[Test]
    public function sendCodeNormalizesEmail(): void
    {
        $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, [
            'email' => '  Test@Example.COM  ',
        ]);

        $this->assertSame(200, $response->status);

        // Code should be stored under the normalized email
        $count = dbCountRecentLoginCodes(self::$db, 'test@example.com');
        $this->assertSame(1, $count);
    }

    // ---- handleAuthVerifyCode ----

    #[Test]
    public function verifyCodeReturnsJwtForValidCode(): void
    {
        $email = 'verify@example.com';
        $this->createLoginCode($email, '123456');

        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '123456',
        ]);

        $this->assertSame(200, $response->status);
        $this->assertArrayHasKey('token', $response->body);
        $this->assertArrayHasKey('user', $response->body);
        $this->assertSame($email, $response->body['user']['email']);
        $this->assertIsInt($response->body['user']['id']);

        // Verify the JWT is valid
        $payload = verifyJwt(self::JWT_CONFIG, $response->body['token']);
        $this->assertNotNull($payload);
        $this->assertSame($email, $payload['email']);
    }

    #[Test]
    public function verifyCodeCreatesNewUser(): void
    {
        $email = 'newuser@example.com';
        $this->createLoginCode($email, '123456');

        // No user exists yet
        $this->assertNull(dbGetUserByEmail(self::$db, $email));

        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '123456',
        ]);

        $this->assertSame(200, $response->status);

        // User should now exist
        $user = dbGetUserByEmail(self::$db, $email);
        $this->assertNotNull($user);
        $this->assertSame($email, $user['email']);
    }

    #[Test]
    public function verifyCodeReturnsExistingUser(): void
    {
        $email = 'existing@example.com';
        $existingUserId = dbCreateUser(self::$db, $email);
        $this->createLoginCode($email, '123456');

        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '123456',
        ]);

        $this->assertSame(200, $response->status);
        $this->assertSame($existingUserId, $response->body['user']['id']);
    }

    #[Test]
    public function verifyCodeAutoLinksProjects(): void
    {
        $email = 'linker@example.com';
        $this->createLoginCode($email, '123456');

        // Create an anonymous project with the owner hash
        $projectId = generatePublicId();
        dbCreateProject(self::$db, $projectId, self::OWNER_HASH, 'private', self::validDataJson(), null);

        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email'          => $email,
            'code'           => '123456',
            'ownerTokenHash' => self::OWNER_HASH,
        ]);

        $this->assertSame(200, $response->status);
        $userId = $response->body['user']['id'];

        // Project should now be linked to the user
        $project = dbGetProjectForAuth(self::$db, $projectId);
        $this->assertSame($userId, (int) $project['user_id']);
    }

    #[Test]
    public function verifyCodeIgnoresInvalidOwnerTokenHash(): void
    {
        $email = 'ignore@example.com';
        $this->createLoginCode($email, '123456');

        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email'          => $email,
            'code'           => '123456',
            'ownerTokenHash' => 'not-a-valid-hash',
        ]);

        // Should succeed — invalid hash is silently ignored
        $this->assertSame(200, $response->status);
        $this->assertArrayHasKey('token', $response->body);
    }

    #[Test]
    public function verifyCodeRejectsWrongCode(): void
    {
        $email = 'wrong@example.com';
        $this->createLoginCode($email, '123456');

        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '999999',
        ]);

        $this->assertSame(401, $response->status);
        $this->assertSame('Invalid or expired code', $response->body['error']);
    }

    #[Test]
    public function verifyCodeRejectsExpiredCode(): void
    {
        $email = 'expired@example.com';
        // Create code that expired 1 second ago
        $this->createLoginCode($email, '123456', -1);

        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '123456',
        ]);

        $this->assertSame(401, $response->status);
        $this->assertSame('Invalid or expired code', $response->body['error']);
    }

    #[Test]
    public function verifyCodeEnforcesPerCodeAttemptLimit(): void
    {
        $email = 'attempts@example.com';
        $this->createLoginCode($email, '123456');

        // Exhaust the 5-attempt limit with wrong codes
        for ($i = 0; $i < 5; $i++) {
            handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
                'email' => $email,
                'code'  => '999999',
            ]);
        }

        // Now even the correct code should fail (code is locked after 5 attempts)
        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '123456',
        ]);

        $this->assertSame(401, $response->status);
    }

    #[Test]
    public function verifyCodeEnforcesGlobalRateLimit(): void
    {
        $email = 'global@example.com';

        // Create two codes and exhaust attempts across both (5 + 5 = 10)
        $this->createLoginCode($email, '111111');
        $this->createLoginCode($email, '222222');

        // 5 wrong guesses on first code
        for ($i = 0; $i < 5; $i++) {
            handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
                'email' => $email,
                'code'  => '000000',
            ]);
        }

        // 5 wrong guesses on second code (total: 10)
        for ($i = 0; $i < 5; $i++) {
            handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
                'email' => $email,
                'code'  => '000001',
            ]);
        }

        // 11th attempt should hit global rate limit
        $this->createLoginCode($email, '333333');
        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '333333',
        ]);

        $this->assertSame(429, $response->status);
        $this->assertStringContainsString('Too many verification attempts', $response->body['error']);
    }

    #[Test]
    public function verifyCodeIncrementsMostRecentCodeOnWrongGuess(): void
    {
        $email = 'increment@example.com';
        $this->createLoginCode($email, '111111');
        $this->createLoginCode($email, '222222');

        // Wrong guess should increment the most recent code (222222)
        handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '999999',
        ]);

        // Verify: first code should have 0 attempts, second should have 1
        $row1 = dbGetActiveLoginCode(self::$db, $email, '111111');
        $row2 = dbGetActiveLoginCode(self::$db, $email, '222222');
        $this->assertSame(0, (int) $row1['attempts']);
        $this->assertSame(1, (int) $row2['attempts']);
    }

    // ---- handleAuthMe ----

    #[Test]
    public function authMeReturnsUserForValidJwt(): void
    {
        $email = 'me@example.com';
        $userId = dbCreateUser(self::$db, $email);
        $auth = ['kind' => 'jwt', 'userId' => $userId, 'email' => $email];

        $response = handleAuthMe(self::$db, $auth);

        $this->assertSame(200, $response->status);
        $this->assertSame($userId, $response->body['user']['id']);
        $this->assertSame($email, $response->body['user']['email']);
    }

    #[Test]
    public function authMeRejectsTokenHashAuth(): void
    {
        $auth = ['kind' => 'token', 'tokenHash' => self::OWNER_HASH];

        $response = handleAuthMe(self::$db, $auth);

        $this->assertSame(401, $response->status);
    }

    #[Test]
    public function authMeRejectsNoAuth(): void
    {
        $auth = ['kind' => 'none'];

        $response = handleAuthMe(self::$db, $auth);

        $this->assertSame(401, $response->status);
    }

    #[Test]
    public function authMeRejectsDeletedUser(): void
    {
        // Auth claims a user ID that doesn't exist in the DB
        $auth = ['kind' => 'jwt', 'userId' => 999999, 'email' => 'ghost@example.com'];

        $response = handleAuthMe(self::$db, $auth);

        $this->assertSame(401, $response->status);
        $this->assertSame('User not found', $response->body['error']);
    }
}
