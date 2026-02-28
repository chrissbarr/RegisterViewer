<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class JwtTest extends TestCase
{
    private const CONFIG = ['jwt_secret' => 'test-secret-key-for-unit-tests!!'];

    #[Test]
    public function createsValidThreePartToken(): void
    {
        $token = createJwt(self::CONFIG, 42, 'user@example.com');
        $parts = explode('.', $token);
        $this->assertCount(3, $parts);

        // Header should decode to HS256
        $header = json_decode(base64UrlDecode($parts[0]), true);
        $this->assertSame('HS256', $header['alg']);
        $this->assertSame('JWT', $header['typ']);
    }

    #[Test]
    public function verifiesValidToken(): void
    {
        $token = createJwt(self::CONFIG, 42, 'user@example.com');
        $payload = verifyJwt(self::CONFIG, $token);

        $this->assertNotNull($payload);
        $this->assertSame(42, $payload['sub']);
        $this->assertSame('user@example.com', $payload['email']);
        $this->assertArrayHasKey('iat', $payload);
        $this->assertArrayHasKey('exp', $payload);
        $this->assertGreaterThan(time(), $payload['exp']);
    }

    #[Test]
    public function rejectsExpiredToken(): void
    {
        // Create a token that expired 1 second ago
        $config = self::CONFIG;
        $header = base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = base64UrlEncode(json_encode([
            'sub'   => 42,
            'email' => 'user@example.com',
            'iat'   => time() - 3600,
            'exp'   => time() - 1,
        ]));
        $signature = base64UrlEncode(
            hash_hmac('sha256', "$header.$payload", $config['jwt_secret'], true)
        );
        $token = "$header.$payload.$signature";

        $this->assertNull(verifyJwt($config, $token));
    }

    #[Test]
    public function rejectsTamperedPayload(): void
    {
        $token = createJwt(self::CONFIG, 42, 'user@example.com');
        $parts = explode('.', $token);

        // Tamper with the payload (change user ID)
        $payload = json_decode(base64UrlDecode($parts[1]), true);
        $payload['sub'] = 999;
        $parts[1] = base64UrlEncode(json_encode($payload));

        $tampered = implode('.', $parts);
        $this->assertNull(verifyJwt(self::CONFIG, $tampered));
    }

    #[Test]
    public function rejectsWrongSecret(): void
    {
        $token = createJwt(self::CONFIG, 42, 'user@example.com');
        $wrongConfig = ['jwt_secret' => 'wrong-secret'];
        $this->assertNull(verifyJwt($wrongConfig, $token));
    }

    #[Test]
    public function rejectsMalformedToken(): void
    {
        $this->assertNull(verifyJwt(self::CONFIG, 'not-a-jwt'));
        $this->assertNull(verifyJwt(self::CONFIG, 'a.b'));
        $this->assertNull(verifyJwt(self::CONFIG, ''));
    }

    #[Test]
    public function rejectsTokenMissingRequiredFields(): void
    {
        $config = self::CONFIG;
        $header = base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));

        // Missing 'sub'
        $payload = base64UrlEncode(json_encode([
            'email' => 'user@example.com',
            'iat'   => time(),
            'exp'   => time() + 3600,
        ]));
        $sig = base64UrlEncode(hash_hmac('sha256', "$header.$payload", $config['jwt_secret'], true));
        $this->assertNull(verifyJwt($config, "$header.$payload.$sig"));

        // Missing 'email'
        $payload = base64UrlEncode(json_encode([
            'sub' => 42,
            'iat' => time(),
            'exp' => time() + 3600,
        ]));
        $sig = base64UrlEncode(hash_hmac('sha256', "$header.$payload", $config['jwt_secret'], true));
        $this->assertNull(verifyJwt($config, "$header.$payload.$sig"));
    }
}
