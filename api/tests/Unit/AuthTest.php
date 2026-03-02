<?php

declare(strict_types=1);

use Firebase\JWT\JWT;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class AuthTest extends TestCase
{
    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION']);
        unset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
    }

    // ---- extractAuth tests ----

    private const JWT_CONFIG = ['jwt_secret' => 'test-secret-for-auth-tests-32char'];

    #[Test]
    public function extractAuthReturnsNoneForHexHash(): void
    {
        $hash = '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e';
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $hash;
        $auth = extractAuth(self::JWT_CONFIG);
        $this->assertSame('none', $auth['kind']);
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
        $token = JWT::encode([
            'sub' => 1, 'email' => 'x@x.com', 'iat' => time() - 3600, 'exp' => time() - 1,
        ], self::JWT_CONFIG['jwt_secret'], 'HS256');
        $_SERVER['HTTP_AUTHORIZATION'] = "Bearer $token";

        $auth = extractAuth(self::JWT_CONFIG);
        $this->assertSame('none', $auth['kind']);
    }

    // ---- isOwnerOrUser tests ----

    #[Test]
    public function isOwnerOrUserWithUserIdMatch(): void
    {
        $auth = ['kind' => 'jwt', 'userId' => 42, 'email' => 'user@example.com'];
        $project = ['user_id' => 42];
        $this->assertTrue(isOwnerOrUser($auth, $project));
    }

    #[Test]
    public function isOwnerOrUserWithNoMatch(): void
    {
        $auth = ['kind' => 'jwt', 'userId' => 99, 'email' => 'other@example.com'];
        $project = ['user_id' => 42];
        $this->assertFalse(isOwnerOrUser($auth, $project));
    }

    #[Test]
    public function isOwnerOrUserWithNoneKind(): void
    {
        $auth = ['kind' => 'none'];
        $project = ['user_id' => null];
        $this->assertFalse(isOwnerOrUser($auth, $project));
    }

    #[Test]
    public function isOwnerOrUserJwtDoesNotMatchNullUserId(): void
    {
        $auth = ['kind' => 'jwt', 'userId' => 42, 'email' => 'user@example.com'];
        $project = ['user_id' => null];
        $this->assertFalse(isOwnerOrUser($auth, $project));
    }
}
