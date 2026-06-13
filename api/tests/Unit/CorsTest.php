<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class CorsTest extends TestCase
{
    private function productionConfig(): array
    {
        return [
            'environment' => 'production',
            'allowed_origins' => [
                'https://www.registerviewer.com',
            ],
        ];
    }

    private function devConfig(): array
    {
        return [
            'environment' => 'development',
            'allowed_origins' => [
                'https://www.registerviewer.com',
            ],
        ];
    }

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_ORIGIN']);
    }

    #[Test]
    public function allowedOriginReturnsCorsHeaders(): void
    {
        $_SERVER['HTTP_ORIGIN'] = 'https://www.registerviewer.com';
        $headers = computeCorsHeaders($this->productionConfig());

        $this->assertSame('https://www.registerviewer.com', $headers['Access-Control-Allow-Origin']);
        $this->assertSame('GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS', $headers['Access-Control-Allow-Methods']);
        $this->assertArrayHasKey('Access-Control-Allow-Headers', $headers);
        $this->assertSame('Origin', $headers['Vary']);
    }

    #[Test]
    public function disallowedOriginReturnsEmpty(): void
    {
        $_SERVER['HTTP_ORIGIN'] = 'https://evil.com';
        $headers = computeCorsHeaders($this->productionConfig());

        $this->assertSame([], $headers);
    }

    #[Test]
    public function missingOriginReturnsEmpty(): void
    {
        unset($_SERVER['HTTP_ORIGIN']);
        $headers = computeCorsHeaders($this->productionConfig());

        $this->assertSame([], $headers);
    }

    #[Test]
    public function localhostAllowedInDevMode(): void
    {
        $_SERVER['HTTP_ORIGIN'] = 'http://localhost:5173';
        $headers = computeCorsHeaders($this->devConfig());

        $this->assertSame('http://localhost:5173', $headers['Access-Control-Allow-Origin']);
    }

    #[Test]
    public function localhostRejectedInProduction(): void
    {
        $_SERVER['HTTP_ORIGIN'] = 'http://localhost:5173';
        $headers = computeCorsHeaders($this->productionConfig());

        $this->assertSame([], $headers);
    }

    #[Test]
    public function isLocalhostOriginVariants(): void
    {
        $this->assertTrue(isLocalhostOrigin('http://localhost'));
        $this->assertTrue(isLocalhostOrigin('http://localhost:8080'));
        $this->assertTrue(isLocalhostOrigin('http://127.0.0.1'));
        $this->assertTrue(isLocalhostOrigin('http://127.0.0.1:3000'));
        $this->assertFalse(isLocalhostOrigin('http://example.com'));
        $this->assertFalse(isLocalhostOrigin('not-a-url'));
    }
}
