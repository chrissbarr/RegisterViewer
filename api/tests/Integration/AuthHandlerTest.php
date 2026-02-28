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
        self::$db->exec('DELETE FROM revoked_tokens');
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$db !== null) {
            self::$db->exec('DELETE FROM projects');
            self::$db->exec('DELETE FROM login_codes');
            self::$db->exec('DELETE FROM users');
            self::$db->exec('DELETE FROM revoked_tokens');
            self::$db = null;
        }
    }

    /**
     * Create a login code in the DB (hashed, matching production behavior) and return the raw code string.
     */
    private function createLoginCode(string $email, string $code = '123456', int $ttlSeconds = 600): string
    {
        $expiresAt = gmdate('Y-m-d H:i:s', time() + $ttlSeconds);
        $codeHash = hash('sha256', $code);
        dbCreateLoginCode(self::$db, $email, $codeHash, $expiresAt);
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

        // Wrong guess should increment exactly one active code via
        // dbIncrementMostRecentLoginCodeAttempts (ORDER BY created_at DESC LIMIT 1).
        // When both codes share the same second-precision timestamp, which one
        // gets incremented is non-deterministic, so we assert on the total.
        handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => $email,
            'code'  => '999999',
        ]);

        $row1 = dbGetActiveLoginCode(self::$db, $email, hash('sha256', '111111'));
        $row2 = dbGetActiveLoginCode(self::$db, $email, hash('sha256', '222222'));
        $attempts1 = (int) $row1['attempts'];
        $attempts2 = (int) $row2['attempts'];

        // Exactly one code should have been incremented
        $this->assertSame(1, $attempts1 + $attempts2, 'Total attempts across both codes should be 1');
        // One should be 0 and the other 1
        $this->assertTrue(
            ($attempts1 === 0 && $attempts2 === 1) || ($attempts1 === 1 && $attempts2 === 0),
            'Exactly one code should have 1 attempt, the other 0'
        );
    }

    #[Test]
    public function sendCodeStoresHashedCodeNotPlaintext(): void
    {
        $email = 'hash-check@example.com';
        handleAuthSendCode(self::$db, self::JWT_CONFIG, ['email' => $email]);

        // Query the DB directly — the stored code should be a 64-char SHA-256 hex digest
        $stmt = self::$db->prepare(
            'SELECT code FROM login_codes WHERE email = :email ORDER BY created_at DESC LIMIT 1'
        );
        $stmt->execute(['email' => $email]);
        $storedCode = $stmt->fetchColumn();

        $this->assertSame(64, strlen($storedCode), 'Stored code should be a 64-char SHA-256 hash');
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $storedCode);
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

    // ---- handleAuthLogout ----

    #[Test]
    public function logoutRevokesToken(): void
    {
        $email = 'logout@example.com';
        $userId = dbCreateUser(self::$db, $email);
        $token = createJwt(self::JWT_CONFIG, $userId, $email);
        $payload = verifyJwt(self::JWT_CONFIG, $token);

        $auth = [
            'kind'   => 'jwt',
            'userId' => $userId,
            'email'  => $email,
            'jti'    => $payload['jti'],
            'exp'    => $payload['exp'],
        ];

        $response = handleAuthLogout(self::$db, $auth);
        $this->assertSame(204, $response->status);

        // Token's jti should now be in revoked_tokens
        $this->assertTrue(dbIsTokenRevoked(self::$db, $payload['jti']));
    }

    #[Test]
    public function logoutRejectsNonJwtAuth(): void
    {
        $auth = ['kind' => 'token', 'tokenHash' => self::OWNER_HASH];
        $response = handleAuthLogout(self::$db, $auth);
        $this->assertSame(401, $response->status);
    }

    #[Test]
    public function logoutRejectsNoAuth(): void
    {
        $auth = ['kind' => 'none'];
        $response = handleAuthLogout(self::$db, $auth);
        $this->assertSame(401, $response->status);
    }

    #[Test]
    public function revokedTokenIsRejectedByExtractAuth(): void
    {
        $email = 'revoked@example.com';
        $userId = dbCreateUser(self::$db, $email);
        $token = createJwt(self::JWT_CONFIG, $userId, $email);
        $payload = verifyJwt(self::JWT_CONFIG, $token);

        // Token works before revocation
        $_SERVER['HTTP_AUTHORIZATION'] = "Bearer $token";
        $auth = extractAuth(self::JWT_CONFIG, self::$db);
        $this->assertSame('jwt', $auth['kind']);

        // Revoke the token
        $expiresAt = gmdate('Y-m-d H:i:s', $payload['exp']);
        dbRevokeToken(self::$db, $payload['jti'], $expiresAt);

        // Token should now be rejected
        $auth = extractAuth(self::JWT_CONFIG, self::$db);
        $this->assertSame('none', $auth['kind']);

        unset($_SERVER['HTTP_AUTHORIZATION']);
    }

    #[Test]
    public function extractAuthReturnsJtiAndExp(): void
    {
        $email = 'jti@example.com';
        $userId = dbCreateUser(self::$db, $email);
        $token = createJwt(self::JWT_CONFIG, $userId, $email);

        $_SERVER['HTTP_AUTHORIZATION'] = "Bearer $token";
        $auth = extractAuth(self::JWT_CONFIG, self::$db);

        $this->assertSame('jwt', $auth['kind']);
        $this->assertArrayHasKey('jti', $auth);
        $this->assertArrayHasKey('exp', $auth);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $auth['jti']);
        $this->assertIsInt($auth['exp']);

        unset($_SERVER['HTTP_AUTHORIZATION']);
    }

    // ---- dbPurgeExpiredLoginCodes ----

    #[Test]
    public function purgeDeletesExpiredAndUsedCodesOlderThan24Hours(): void
    {
        // Insert an old, used code (created 48 hours ago)
        $stmt = self::$db->prepare(
            "INSERT INTO login_codes (email, code, expires_at, used, created_at)
             VALUES (:email, :code, :expires, 1, DATE_SUB(NOW(), INTERVAL 48 HOUR))"
        );
        $stmt->execute([
            'email'   => 'old-used@example.com',
            'code'    => hash('sha256', '111111'),
            'expires' => gmdate('Y-m-d H:i:s', time() - 172800),
        ]);

        // Insert an old, expired (but not used) code (created 48 hours ago)
        $stmt = self::$db->prepare(
            "INSERT INTO login_codes (email, code, expires_at, used, created_at)
             VALUES (:email, :code, :expires, 0, DATE_SUB(NOW(), INTERVAL 48 HOUR))"
        );
        $stmt->execute([
            'email'   => 'old-expired@example.com',
            'code'    => hash('sha256', '222222'),
            'expires' => gmdate('Y-m-d H:i:s', time() - 172800),
        ]);

        // Insert a fresh, active code (should NOT be purged)
        $this->createLoginCode('fresh@example.com', '333333');

        // Insert a recently used code (created now, used = 1 — should NOT be purged because <24h old)
        $stmt = self::$db->prepare(
            "INSERT INTO login_codes (email, code, expires_at, used)
             VALUES (:email, :code, :expires, 1)"
        );
        $stmt->execute([
            'email'   => 'recent-used@example.com',
            'code'    => hash('sha256', '444444'),
            'expires' => gmdate('Y-m-d H:i:s', time() + 600),
        ]);

        $deleted = dbPurgeExpiredLoginCodes(self::$db);

        $this->assertSame(2, $deleted, 'Should delete exactly the 2 old codes');

        // Verify remaining rows
        $remaining = (int) self::$db->query('SELECT COUNT(*) FROM login_codes')->fetchColumn();
        $this->assertSame(2, $remaining, 'Fresh active code and recently used code should survive');
    }

    #[Test]
    public function purgeReturnsZeroWhenNothingToDelete(): void
    {
        // Insert only a fresh active code
        $this->createLoginCode('active@example.com', '123456');

        $deleted = dbPurgeExpiredLoginCodes(self::$db);

        $this->assertSame(0, $deleted);
    }

    // ---- PERF-15: Global and IP-based rate limiting ----

    #[Test]
    public function sendCodeEnforcesGlobalRateLimit(): void
    {
        // Insert 30 login codes (the global limit) directly to avoid per-email limits
        $stmt = self::$db->prepare(
            "INSERT INTO login_codes (email, code, expires_at)
             VALUES (:email, :code, :expires)"
        );
        for ($i = 0; $i < 30; $i++) {
            $stmt->execute([
                'email'   => "global-{$i}@example.com",
                'code'    => hash('sha256', str_pad((string) $i, 6, '0', STR_PAD_LEFT)),
                'expires' => gmdate('Y-m-d H:i:s', time() + 600),
            ]);
        }

        // 31st request from a new email should hit global limit (503)
        $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, [
            'email' => 'one-more@example.com',
        ]);

        $this->assertSame(503, $response->status);
        $this->assertStringContainsString('Service temporarily unavailable', $response->body['error']);
    }

    #[Test]
    public function sendCodeEnforcesIpRateLimit(): void
    {
        // Simulate 5 codes from the same IP
        $ip = '192.0.2.1';
        $stmt = self::$db->prepare(
            "INSERT INTO login_codes (email, code, expires_at, ip_address)
             VALUES (:email, :code, :expires, :ip)"
        );
        for ($i = 0; $i < 5; $i++) {
            $stmt->execute([
                'email'   => "ip-test-{$i}@example.com",
                'code'    => hash('sha256', str_pad((string) $i, 6, '0', STR_PAD_LEFT)),
                'expires' => gmdate('Y-m-d H:i:s', time() + 600),
                'ip'      => $ip,
            ]);
        }

        // Set REMOTE_ADDR to the same IP
        $_SERVER['REMOTE_ADDR'] = $ip;
        try {
            $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, [
                'email' => 'another@example.com',
            ]);

            $this->assertSame(429, $response->status);
            $this->assertStringContainsString('Too many requests', $response->body['error']);
        } finally {
            unset($_SERVER['REMOTE_ADDR']);
        }
    }

    #[Test]
    public function sendCodeStoresClientIpAddress(): void
    {
        $_SERVER['REMOTE_ADDR'] = '203.0.113.42';
        try {
            $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, [
                'email' => 'ip-store@example.com',
            ]);

            $this->assertSame(200, $response->status);

            // Verify IP was stored in DB
            $stmt = self::$db->prepare(
                'SELECT ip_address FROM login_codes WHERE email = :email ORDER BY created_at DESC LIMIT 1'
            );
            $stmt->execute(['email' => 'ip-store@example.com']);
            $storedIp = $stmt->fetchColumn();

            $this->assertSame('203.0.113.42', $storedIp);
        } finally {
            unset($_SERVER['REMOTE_ADDR']);
        }
    }

    #[Test]
    public function verifyCodeEnforcesGlobalVerifyRateLimit(): void
    {
        // Insert codes with high attempt counts to exceed the global 100/minute limit.
        // Each row with attempts=25 contributes 25 to the SUM; 4 rows = 100.
        $stmt = self::$db->prepare(
            "INSERT INTO login_codes (email, code, expires_at, attempts)
             VALUES (:email, :code, :expires, :attempts)"
        );
        for ($i = 0; $i < 4; $i++) {
            $stmt->execute([
                'email'    => "global-verify-{$i}@example.com",
                'code'     => hash('sha256', str_pad((string) $i, 6, '0', STR_PAD_LEFT)),
                'expires'  => gmdate('Y-m-d H:i:s', time() + 600),
                'attempts' => 25,
            ]);
        }

        // Next verify attempt for any email should hit global limit (503)
        $this->createLoginCode('victim@example.com', '123456');
        $response = handleAuthVerifyCode(self::$db, self::JWT_CONFIG, [
            'email' => 'victim@example.com',
            'code'  => '123456',
        ]);

        $this->assertSame(503, $response->status);
        $this->assertStringContainsString('Service temporarily unavailable', $response->body['error']);
    }

    #[Test]
    public function dbCountAllRecentLoginCodesCountsCorrectly(): void
    {
        // Insert 3 recent codes
        for ($i = 0; $i < 3; $i++) {
            $this->createLoginCode("count-{$i}@example.com", str_pad((string) $i, 6, '0', STR_PAD_LEFT));
        }

        $count = dbCountAllRecentLoginCodes(self::$db, 60);
        $this->assertSame(3, $count);
    }

    #[Test]
    public function sendCodeSkipsIpLimitWhenRemoteAddrAbsent(): void
    {
        // Ensure REMOTE_ADDR is not set
        unset($_SERVER['REMOTE_ADDR']);

        $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, [
            'email' => 'no-ip@example.com',
        ]);

        // Should succeed — IP rate limiting is gracefully skipped
        $this->assertSame(200, $response->status);
        $this->assertTrue($response->body['ok']);

        // Verify ip_address is NULL in the DB
        $stmt = self::$db->prepare(
            'SELECT ip_address FROM login_codes WHERE email = :email ORDER BY created_at DESC LIMIT 1'
        );
        $stmt->execute(['email' => 'no-ip@example.com']);
        $storedIp = $stmt->fetchColumn();

        $this->assertNull($storedIp, 'ip_address should be NULL when REMOTE_ADDR is absent');
    }

    #[Test]
    public function sendCodeHandlesIpv6Address(): void
    {
        $ipv6 = '2001:db8::1';
        $_SERVER['REMOTE_ADDR'] = $ipv6;
        try {
            $response = handleAuthSendCode(self::$db, self::JWT_CONFIG, [
                'email' => 'ipv6@example.com',
            ]);

            $this->assertSame(200, $response->status);

            // Verify IPv6 address was stored
            $stmt = self::$db->prepare(
                'SELECT ip_address FROM login_codes WHERE email = :email ORDER BY created_at DESC LIMIT 1'
            );
            $stmt->execute(['email' => 'ipv6@example.com']);
            $storedIp = $stmt->fetchColumn();

            $this->assertSame($ipv6, $storedIp);

            // Verify IP counting works for IPv6
            $count = dbCountRecentLoginCodesByIp(self::$db, $ipv6, 900);
            $this->assertSame(1, $count);
        } finally {
            unset($_SERVER['REMOTE_ADDR']);
        }
    }

    #[Test]
    public function dbCountAllRecentVerifyAttemptsCountsCorrectly(): void
    {
        // Insert codes with known attempt counts
        $stmt = self::$db->prepare(
            "INSERT INTO login_codes (email, code, expires_at, attempts)
             VALUES (:email, :code, :expires, :attempts)"
        );
        $stmt->execute([
            'email'    => 'vattempt-1@example.com',
            'code'     => hash('sha256', '111111'),
            'expires'  => gmdate('Y-m-d H:i:s', time() + 600),
            'attempts' => 3,
        ]);
        $stmt->execute([
            'email'    => 'vattempt-2@example.com',
            'code'     => hash('sha256', '222222'),
            'expires'  => gmdate('Y-m-d H:i:s', time() + 600),
            'attempts' => 7,
        ]);

        $total = dbCountAllRecentVerifyAttempts(self::$db, 60);
        $this->assertSame(10, $total);
    }

    #[Test]
    public function dbCountRecentLoginCodesByIpCountsCorrectly(): void
    {
        $ip = '198.51.100.1';
        $stmt = self::$db->prepare(
            "INSERT INTO login_codes (email, code, expires_at, ip_address)
             VALUES (:email, :code, :expires, :ip)"
        );

        // 2 codes from target IP
        for ($i = 0; $i < 2; $i++) {
            $stmt->execute([
                'email'   => "ipcount-{$i}@example.com",
                'code'    => hash('sha256', str_pad((string) $i, 6, '0', STR_PAD_LEFT)),
                'expires' => gmdate('Y-m-d H:i:s', time() + 600),
                'ip'      => $ip,
            ]);
        }

        // 1 code from different IP
        $stmt->execute([
            'email'   => 'other-ip@example.com',
            'code'    => hash('sha256', '999999'),
            'expires' => gmdate('Y-m-d H:i:s', time() + 600),
            'ip'      => '198.51.100.99',
        ]);

        $count = dbCountRecentLoginCodesByIp(self::$db, $ip, 900);
        $this->assertSame(2, $count);
    }
}
