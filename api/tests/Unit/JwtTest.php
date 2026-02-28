<?php

declare(strict_types=1);

use Firebase\JWT\JWT;
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
        $headerJson = base64_decode(strtr($parts[0], '-_', '+/'));
        $header = json_decode($headerJson, true);
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
    public function tokenContainsJtiClaim(): void
    {
        $token = createJwt(self::CONFIG, 42, 'user@example.com');
        $payload = verifyJwt(self::CONFIG, $token);

        $this->assertNotNull($payload);
        $this->assertArrayHasKey('jti', $payload);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $payload['jti']);
    }

    #[Test]
    public function eachTokenGetsUniqueJti(): void
    {
        $token1 = createJwt(self::CONFIG, 42, 'user@example.com');
        $token2 = createJwt(self::CONFIG, 42, 'user@example.com');

        $payload1 = verifyJwt(self::CONFIG, $token1);
        $payload2 = verifyJwt(self::CONFIG, $token2);

        $this->assertNotSame($payload1['jti'], $payload2['jti']);
    }

    #[Test]
    public function tokenExpiresIn24Hours(): void
    {
        $token = createJwt(self::CONFIG, 42, 'user@example.com');
        $payload = verifyJwt(self::CONFIG, $token);

        $this->assertNotNull($payload);
        $expectedExpiry = $payload['iat'] + (24 * 60 * 60);
        $this->assertSame($expectedExpiry, $payload['exp']);
    }

    #[Test]
    public function rejectsExpiredToken(): void
    {
        // Create a token that expired 1 second ago
        $token = JWT::encode([
            'sub'   => 42,
            'email' => 'user@example.com',
            'iat'   => time() - 3600,
            'exp'   => time() - 1,
            'jti'   => bin2hex(random_bytes(16)),
        ], self::CONFIG['jwt_secret'], 'HS256');

        $this->assertNull(verifyJwt(self::CONFIG, $token));
    }

    #[Test]
    public function rejectsTamperedPayload(): void
    {
        $token = createJwt(self::CONFIG, 42, 'user@example.com');
        $parts = explode('.', $token);

        // Tamper with the payload (change user ID)
        $payloadJson = base64_decode(strtr($parts[1], '-_', '+/'));
        $payload = json_decode($payloadJson, true);
        $payload['sub'] = 999;
        $parts[1] = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');

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
        $now = time();

        // Missing 'sub'
        $token = JWT::encode([
            'email' => 'user@example.com',
            'iat'   => $now,
            'exp'   => $now + 3600,
            'jti'   => bin2hex(random_bytes(16)),
        ], self::CONFIG['jwt_secret'], 'HS256');
        $this->assertNull(verifyJwt(self::CONFIG, $token));

        // Missing 'email'
        $token = JWT::encode([
            'sub' => 42,
            'iat' => $now,
            'exp' => $now + 3600,
            'jti' => bin2hex(random_bytes(16)),
        ], self::CONFIG['jwt_secret'], 'HS256');
        $this->assertNull(verifyJwt(self::CONFIG, $token));
    }

    #[Test]
    public function acceptsTokenWithoutJti(): void
    {
        // Legacy tokens without jti should still verify
        $now = time();
        $token = JWT::encode([
            'sub'   => 42,
            'email' => 'user@example.com',
            'iat'   => $now,
            'exp'   => $now + 3600,
        ], self::CONFIG['jwt_secret'], 'HS256');

        $result = verifyJwt(self::CONFIG, $token);
        $this->assertNotNull($result);
        $this->assertSame(42, $result['sub']);
        $this->assertArrayNotHasKey('jti', $result);
    }
}
