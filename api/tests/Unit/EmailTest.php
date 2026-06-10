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

    // ---- checkEmailHealthCached: TTL cache around the live probe ----

    /** @var list<string> */
    private array $cacheFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->cacheFiles as $file) {
            @unlink($file);
        }
        $this->cacheFiles = [];
    }

    private function tmpCacheFile(): string
    {
        $path = sys_get_temp_dir() . '/email-health-cache-test-' . bin2hex(random_bytes(8)) . '.json';
        $this->cacheFiles[] = $path;
        return $path;
    }

    /**
     * @param array{ok: bool, error?: string} $result
     * @return array{0: callable, 1: callable(): int} Counting checker + call-count getter.
     */
    private function countingChecker(array $result): array
    {
        $calls = 0;
        $checker = function (array $config) use (&$calls, $result): array {
            $calls++;
            return $result;
        };
        return [$checker, function () use (&$calls): int {
            return $calls;
        }];
    }

    #[Test]
    public function cachedHealthCheckInvokesCheckerOnceWithinTtl(): void
    {
        $cacheFile = $this->tmpCacheFile();
        [$checker, $calls] = $this->countingChecker(['ok' => true]);
        $config = ['resend_api_key' => 'test-key'];

        $first = checkEmailHealthCached($config, $cacheFile, 300, $checker);
        $second = checkEmailHealthCached($config, $cacheFile, 300, $checker);

        $this->assertSame(1, $calls());
        $this->assertTrue($first['ok']);
        $this->assertSame($first, $second);
    }

    #[Test]
    public function cachedHealthCheckReinvokesCheckerAfterTtlExpiry(): void
    {
        $cacheFile = $this->tmpCacheFile();
        [$checker, $calls] = $this->countingChecker(['ok' => true]);
        $config = ['resend_api_key' => 'test-key'];

        checkEmailHealthCached($config, $cacheFile, 300, $checker);
        touch($cacheFile, time() - 301);
        $result = checkEmailHealthCached($config, $cacheFile, 300, $checker);

        $this->assertSame(2, $calls());
        $this->assertTrue($result['ok']);
    }

    #[Test]
    public function cachedHealthCheckCachesFailureResults(): void
    {
        $cacheFile = $this->tmpCacheFile();
        [$checker, $calls] = $this->countingChecker(['ok' => false, 'error' => 'Email provider returned HTTP 401']);
        $config = ['resend_api_key' => 'test-key'];

        $first = checkEmailHealthCached($config, $cacheFile, 300, $checker);
        $second = checkEmailHealthCached($config, $cacheFile, 300, $checker);

        $this->assertSame(1, $calls());
        $this->assertFalse($first['ok']);
        $this->assertSame($first, $second);
    }

    #[Test]
    public function cachedHealthCheckTreatsCorruptCacheAsStaleAndRewritesIt(): void
    {
        $cacheFile = $this->tmpCacheFile();
        file_put_contents($cacheFile, 'not-json{{');
        [$checker, $calls] = $this->countingChecker(['ok' => true]);
        $config = ['resend_api_key' => 'test-key'];

        $result = checkEmailHealthCached($config, $cacheFile, 300, $checker);

        $this->assertSame(1, $calls());
        $this->assertTrue($result['ok']);
        $rewritten = json_decode((string) file_get_contents($cacheFile), true);
        $this->assertSame(['ok' => true], $rewritten);
    }

    #[Test]
    public function cachedHealthCheckDegradesToLiveCheckWhenCachePathUnwritable(): void
    {
        $cacheFile = '/nonexistent-dir-' . bin2hex(random_bytes(8)) . '/cache.json';
        [$checker, $calls] = $this->countingChecker(['ok' => true]);
        $config = ['resend_api_key' => 'test-key'];

        $first = checkEmailHealthCached($config, $cacheFile, 300, $checker);
        $second = checkEmailHealthCached($config, $cacheFile, 300, $checker);

        $this->assertSame(2, $calls());
        $this->assertTrue($first['ok']);
        $this->assertTrue($second['ok']);
    }

    #[Test]
    public function cachedHealthCheckShortCircuitsOnMissingApiKeyWithoutTouchingCache(): void
    {
        $cacheFile = $this->tmpCacheFile();
        [$checker, $calls] = $this->countingChecker(['ok' => true]);

        $result = checkEmailHealthCached(['resend_api_key' => ''], $cacheFile, 300, $checker);

        $this->assertFalse($result['ok']);
        $this->assertSame('resend_api_key not configured', $result['error']);
        $this->assertSame(0, $calls());
        $this->assertFileDoesNotExist($cacheFile);
    }
}
