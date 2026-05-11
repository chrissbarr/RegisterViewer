<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class RequestBodyTest extends TestCase
{
    #[Test]
    public function parseBodyRejectsEmptyBody(): void
    {
        $response = parseBody('');

        $this->assertInstanceOf(ApiResponse::class, $response);
        $this->assertSame(400, $response->status);
        $this->assertSame('Invalid JSON body', $response->body['error']);
    }

    #[Test]
    public function parseBodyRejectsMalformedJson(): void
    {
        $response = parseBody('{not-json');

        $this->assertInstanceOf(ApiResponse::class, $response);
        $this->assertSame(400, $response->status);
        $this->assertSame('Invalid JSON body', $response->body['error']);
    }

    #[Test]
    public function parseBodyRejectsJsonArrays(): void
    {
        $response = parseBody('[]');

        $this->assertInstanceOf(ApiResponse::class, $response);
        $this->assertSame(400, $response->status);
        $this->assertSame('Invalid JSON body', $response->body['error']);
    }

    #[Test]
    public function parseBodyReturnsAssociativeAndObjectViews(): void
    {
        $parsed = parseBody('{"data":{"registerValues":{}}}');

        $this->assertIsArray($parsed);
        $this->assertSame([], $parsed['assoc']['data']['registerValues']);
        $this->assertInstanceOf(stdClass::class, $parsed['object']->data->registerValues);
        $this->assertSame('{"registerValues":{}}', extractDataJson($parsed['object']));
    }

    #[Test]
    public function readBodyRejectsOversizedContentLengthBeforeReading(): void
    {
        $reads = 0;
        $response = readBody(
            ['CONTENT_LENGTH' => (string) (LIMITS['MAX_PAYLOAD_SIZE'] + 1)],
            function () use (&$reads): string {
                $reads++;
                return '{}';
            }
        );

        $this->assertSame(0, $reads);
        $this->assertInstanceOf(ApiResponse::class, $response);
        $this->assertSame(400, $response->status);
        $this->assertStringContainsString('at most', $response->body['error']);
    }

    #[Test]
    public function readBodyRejectsOversizedActualBody(): void
    {
        $response = readBody(
            [],
            fn (): string => str_repeat('x', LIMITS['MAX_PAYLOAD_SIZE'] + 1)
        );

        $this->assertInstanceOf(ApiResponse::class, $response);
        $this->assertSame(400, $response->status);
        $this->assertStringContainsString('at most', $response->body['error']);
    }
}
