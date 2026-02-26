<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class IdTest extends TestCase
{
    #[Test]
    public function generatesExactly12Characters(): void
    {
        $id = generatePublicId();
        $this->assertSame(12, strlen($id));
    }

    #[Test]
    public function generatesBase62Only(): void
    {
        // Run multiple times to increase confidence
        for ($i = 0; $i < 50; $i++) {
            $id = generatePublicId();
            $this->assertMatchesRegularExpression('/^[A-Za-z0-9]{12}$/', $id);
        }
    }

    #[Test]
    public function generatesUniqueIds(): void
    {
        $ids = [];
        for ($i = 0; $i < 100; $i++) {
            $ids[] = generatePublicId();
        }
        $this->assertSame(100, count(array_unique($ids)));
    }
}
