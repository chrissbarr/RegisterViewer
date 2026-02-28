<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class EmailTest extends TestCase
{
    private bool $httpsReplaced = false;

    protected function tearDown(): void
    {
        if ($this->httpsReplaced) {
            stream_wrapper_restore('https');
            $this->httpsReplaced = false;
        }
    }

    /**
     * Unregister the https wrapper entirely so file_get_contents returns false.
     */
    private function disableHttps(): void
    {
        stream_wrapper_unregister('https');
        $this->httpsReplaced = true;
    }

    // ---- sendLoginCode: missing / empty API key ----

    #[Test]
    public function returnsFalseWithEmptyApiKey(): void
    {
        $result = sendLoginCode(['resend_api_key' => ''], 'test@example.com', '123456');
        $this->assertFalse($result);
    }

    #[Test]
    public function returnsFalseWithMissingApiKey(): void
    {
        $result = sendLoginCode([], 'test@example.com', '123456');
        $this->assertFalse($result);
    }

    // ---- sendLoginCode: network error ----

    #[Test]
    public function returnsFalseWhenFileGetContentsFails(): void
    {
        $this->disableHttps();

        $config = ['resend_api_key' => 'test_key_abc123'];
        $result = sendLoginCode($config, 'test@example.com', '123456');
        $this->assertFalse($result);
    }

    // ---- parseHttpStatusCode ----

    #[Test]
    public function parsesHttp200Status(): void
    {
        $this->assertSame(200, parseHttpStatusCode(['HTTP/1.1 200 OK']));
    }

    #[Test]
    public function parsesHttp202Status(): void
    {
        $this->assertSame(202, parseHttpStatusCode(['HTTP/1.1 202 Accepted']));
    }

    #[Test]
    public function parsesHttp401Status(): void
    {
        $this->assertSame(401, parseHttpStatusCode(['HTTP/1.1 401 Unauthorized']));
    }

    #[Test]
    public function parsesHttp500Status(): void
    {
        $this->assertSame(500, parseHttpStatusCode(['HTTP/1.1 500 Internal Server Error']));
    }

    #[Test]
    public function parsesHttp429Status(): void
    {
        $this->assertSame(429, parseHttpStatusCode(['HTTP/1.1 429 Too Many Requests']));
    }

    #[Test]
    public function returnsNullForEmptyHeaders(): void
    {
        $this->assertNull(parseHttpStatusCode([]));
    }

    #[Test]
    public function returnsNullForUnparseableStatusLine(): void
    {
        $this->assertNull(parseHttpStatusCode(['GARBAGE']));
    }

    #[Test]
    public function returnsNullForStatusLineWithNoSpaces(): void
    {
        $this->assertNull(parseHttpStatusCode(['200']));
    }
}
