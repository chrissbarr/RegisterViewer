<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class EmailTest extends TestCase
{
    // ---- sendLoginCode / sendEmail: missing / empty API key ----

    #[Test]
    public function sendLoginCodeReturnsFalseWithEmptyApiKey(): void
    {
        $result = sendLoginCode(['resend_api_key' => ''], 'test@example.com', '123456');
        $this->assertFalse($result);
    }

    #[Test]
    public function sendLoginCodeReturnsFalseWithMissingApiKey(): void
    {
        $result = sendLoginCode([], 'test@example.com', '123456');
        $this->assertFalse($result);
    }

    #[Test]
    public function sendEmailReturnsFalseWithEmptyApiKey(): void
    {
        $result = sendEmail(['resend_api_key' => ''], 'test@example.com', 'Subject', 'Body');
        $this->assertFalse($result);
    }

    #[Test]
    public function sendEmailReturnsFalseWithMissingApiKey(): void
    {
        $result = sendEmail([], 'test@example.com', 'Subject', 'Body');
        $this->assertFalse($result);
    }

    // ---- checkEmailHealth: missing / empty API key ----

    #[Test]
    public function healthCheckFailsWithEmptyApiKey(): void
    {
        $result = checkEmailHealth(['resend_api_key' => '']);
        $this->assertFalse($result['ok']);
        $this->assertSame('resend_api_key not configured', $result['error']);
    }

    #[Test]
    public function healthCheckFailsWithMissingApiKey(): void
    {
        $result = checkEmailHealth([]);
        $this->assertFalse($result['ok']);
        $this->assertSame('resend_api_key not configured', $result['error']);
    }
}
