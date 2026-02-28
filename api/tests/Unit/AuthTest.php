<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class AuthTest extends TestCase
{
    private const VALID_HASH = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION']);
        unset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
    }

    #[Test]
    public function extractsValidBearerToken(): void
    {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . self::VALID_HASH;
        $this->assertSame(self::VALID_HASH, extractTokenHash());
    }

    #[Test]
    public function returnsNullWhenNoHeader(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION']);
        unset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
        $this->assertNull(extractTokenHash());
    }

    #[Test]
    public function returnsNullForNonBearerScheme(): void
    {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Basic ' . self::VALID_HASH;
        $this->assertNull(extractTokenHash());
    }

    #[Test]
    public function returnsNullForWrongLengthHash(): void
    {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer abc123';
        $this->assertNull(extractTokenHash());
    }

    #[Test]
    public function returnsNullForNonHexHash(): void
    {
        // 64 chars but contains non-hex characters
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . str_repeat('zz', 32);
        $this->assertNull(extractTokenHash());
    }

    #[Test]
    public function extractsFromRedirectHeader(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION']);
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] = 'Bearer ' . self::VALID_HASH;
        $this->assertSame(self::VALID_HASH, extractTokenHash());
    }

    #[Test]
    public function prefersDirectOverRedirectHeader(): void
    {
        $otherHash = str_repeat('ab', 32);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . self::VALID_HASH;
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] = 'Bearer ' . $otherHash;
        $this->assertSame(self::VALID_HASH, extractTokenHash());
    }

    #[Test]
    public function lowercasesUppercaseHash(): void
    {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . strtoupper(self::VALID_HASH);
        $this->assertSame(self::VALID_HASH, extractTokenHash());
    }

    #[Test]
    public function isOwnerMatchingHash(): void
    {
        $project = ['owner_token_hash' => self::VALID_HASH];
        $this->assertTrue(isOwner(self::VALID_HASH, $project));
    }

    #[Test]
    public function isOwnerNonMatchingHash(): void
    {
        $project = ['owner_token_hash' => self::VALID_HASH];
        $this->assertFalse(isOwner(str_repeat('00', 32), $project));
    }

    // ---- extractAuth tests ----

    private const JWT_CONFIG = ['jwt_secret' => 'test-secret-for-auth-tests-32char'];

    #[Test]
    public function extractAuthReturnsTokenKindForHexHash(): void
    {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . self::VALID_HASH;
        $auth = extractAuth(self::JWT_CONFIG);
        $this->assertSame('token', $auth['kind']);
        $this->assertSame(self::VALID_HASH, $auth['tokenHash']);
    }

    #[Test]
    public function extractAuthReturnsJwtKindForValidJwt(): void
    {
        $jwt = createJwt(self::JWT_CONFIG, 42, 'user@example.com');
        $_SERVER['HTTP_AUTHORIZATION'] = "Bearer $jwt";
        $auth = extractAuth(self::JWT_CONFIG);
        $this->assertSame('jwt', $auth['kind']);
        $this->assertSame(42, $auth['userId']);
        $this->assertSame('user@example.com', $auth['email']);
    }

    #[Test]
    public function extractAuthReturnsNoneForNoHeader(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION']);
        unset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
        $auth = extractAuth(self::JWT_CONFIG);
        $this->assertSame('none', $auth['kind']);
    }

    #[Test]
    public function extractAuthReturnsNoneForGarbage(): void
    {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer garbage-value';
        $auth = extractAuth(self::JWT_CONFIG);
        $this->assertSame('none', $auth['kind']);
    }

    #[Test]
    public function extractAuthReturnsNoneForExpiredJwt(): void
    {
        $config = self::JWT_CONFIG;
        $header = base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = base64UrlEncode(json_encode([
            'sub' => 1, 'email' => 'x@x.com', 'iat' => time() - 3600, 'exp' => time() - 1,
        ]));
        $sig = base64UrlEncode(hash_hmac('sha256', "$header.$payload", $config['jwt_secret'], true));
        $_SERVER['HTTP_AUTHORIZATION'] = "Bearer $header.$payload.$sig";

        $auth = extractAuth($config);
        $this->assertSame('none', $auth['kind']);
    }

    // ---- isOwnerOrUser tests ----

    #[Test]
    public function isOwnerOrUserWithTokenMatch(): void
    {
        $auth = ['kind' => 'token', 'tokenHash' => self::VALID_HASH];
        $project = ['owner_token_hash' => self::VALID_HASH, 'user_id' => null];
        $this->assertTrue(isOwnerOrUser($auth, $project));
    }

    #[Test]
    public function isOwnerOrUserWithUserIdMatch(): void
    {
        $auth = ['kind' => 'jwt', 'userId' => 42, 'email' => 'user@example.com'];
        $project = ['owner_token_hash' => self::VALID_HASH, 'user_id' => 42];
        $this->assertTrue(isOwnerOrUser($auth, $project));
    }

    #[Test]
    public function isOwnerOrUserWithNoMatch(): void
    {
        $auth = ['kind' => 'jwt', 'userId' => 99, 'email' => 'other@example.com'];
        $project = ['owner_token_hash' => self::VALID_HASH, 'user_id' => 42];
        $this->assertFalse(isOwnerOrUser($auth, $project));
    }

    #[Test]
    public function isOwnerOrUserWithNoneKind(): void
    {
        $auth = ['kind' => 'none'];
        $project = ['owner_token_hash' => self::VALID_HASH, 'user_id' => null];
        $this->assertFalse(isOwnerOrUser($auth, $project));
    }

    #[Test]
    public function isOwnerOrUserJwtDoesNotMatchNullUserId(): void
    {
        $auth = ['kind' => 'jwt', 'userId' => 42, 'email' => 'user@example.com'];
        $project = ['owner_token_hash' => self::VALID_HASH, 'user_id' => null];
        $this->assertFalse(isOwnerOrUser($auth, $project));
    }
}
