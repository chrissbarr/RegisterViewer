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
}
