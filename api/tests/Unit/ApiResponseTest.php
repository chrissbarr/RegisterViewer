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
}
