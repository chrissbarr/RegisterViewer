<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class OtpTest extends TestCase
{
    private const CONFIG = ['otp_hash_secret' => 'test-otp-hash-secret-not-for-production'];

    #[Test]
    public function createOtpVerifierReturnsExpectedHmac(): void
    {
        $email = 'user@example.com';
        $code = '123456';
        $expected = hash_hmac(
            'sha256',
            OTP_VERIFIER_CONTEXT . "\0" . $email . "\0" . $code,
            self::CONFIG['otp_hash_secret']
        );

        $this->assertSame($expected, createOtpVerifier(self::CONFIG, $email, $code));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $expected);
    }

    #[Test]
    public function verifierIsDomainSeparatedByEmailAndSecret(): void
    {
        $first = createOtpVerifier(self::CONFIG, 'first@example.com', '123456');
        $second = createOtpVerifier(self::CONFIG, 'second@example.com', '123456');
        $otherSecret = createOtpVerifier(
            ['otp_hash_secret' => 'other-otp-hash-secret-not-for-production'],
            'first@example.com',
            '123456'
        );

        $this->assertNotSame($first, $second);
        $this->assertNotSame($first, $otherSecret);
    }

    #[Test]
    public function verifierDoesNotMatchUnsaltedSha256Digest(): void
    {
        $verifier = createOtpVerifier(self::CONFIG, 'user@example.com', '123456');

        $this->assertNotSame(hash('sha256', '123456'), $verifier);
        $this->assertTrue(verifyOtpCode(self::CONFIG, 'user@example.com', '123456', $verifier));
        $this->assertFalse(verifyOtpCode(self::CONFIG, 'user@example.com', '123456', hash('sha256', '123456')));
    }

    #[Test]
    public function verifyOtpCodeRejectsWrongEmailOrCode(): void
    {
        $verifier = createOtpVerifier(self::CONFIG, 'user@example.com', '123456');

        $this->assertFalse(verifyOtpCode(self::CONFIG, 'other@example.com', '123456', $verifier));
        $this->assertFalse(verifyOtpCode(self::CONFIG, 'user@example.com', '654321', $verifier));
    }

    #[Test]
    public function missingOrShortOtpHashSecretIsRejected(): void
    {
        $this->assertFalse(isOtpHashSecretConfigured([]));
        $this->assertFalse(isOtpHashSecretConfigured(['otp_hash_secret' => 'too-short']));

        $this->expectException(RuntimeException::class);
        createOtpVerifier(['otp_hash_secret' => 'too-short'], 'user@example.com', '123456');
    }
}
