<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class ApiResponseTest extends TestCase
{
    #[Test]
    public function schemaNotReadyResponseUsesSharedRetryableContract(): void
    {
        $response = schemaNotReadyResponse();

        $this->assertSame(503, $response->status);
        $this->assertSame([
            'error' => 'Service temporarily unavailable',
            'code' => 'schema_not_ready',
        ], $response->body);
        $this->assertSame(['Retry-After' => '5'], $response->headers);
    }

    // ---- withDefaultCacheControl ----

    #[Test]
    public function withDefaultCacheControlAddsNoStoreToEmptyHeaders(): void
    {
        $this->assertSame(['Cache-Control' => 'no-store'], withDefaultCacheControl([]));
    }

    #[Test]
    public function withDefaultCacheControlAddsNoStorePreservingUnrelatedHeaders(): void
    {
        $this->assertSame(
            ['Retry-After' => '5', 'Cache-Control' => 'no-store'],
            withDefaultCacheControl(['Retry-After' => '5'])
        );
    }

    #[Test]
    public function withDefaultCacheControlLeavesExplicitCacheControlUntouched(): void
    {
        $headers = ['Cache-Control' => 'private, max-age=60', 'Vary' => 'Origin, Authorization'];

        $this->assertSame($headers, withDefaultCacheControl($headers));
    }

    #[Test]
    public function withDefaultCacheControlMatchesExistingKeyCaseInsensitively(): void
    {
        $headers = ['cache-control' => 'private, no-store'];

        $this->assertSame($headers, withDefaultCacheControl($headers));
    }
}
