<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class TimeTest extends TestCase
{
    private string $previousTimezone;

    protected function setUp(): void
    {
        $this->previousTimezone = date_default_timezone_get();
    }

    protected function tearDown(): void
    {
        date_default_timezone_set($this->previousTimezone);
    }

    #[Test]
    public function utcDbDateTimeIgnoresPhpDefaultTimezone(): void
    {
        date_default_timezone_set('Australia/Adelaide');

        $this->assertSame('1970-01-01 00:00:00', utcDbDateTime(0));
    }

    #[Test]
    public function utcIsoTimestampIgnoresPhpDefaultTimezone(): void
    {
        date_default_timezone_set('Australia/Adelaide');

        $this->assertSame('1970-01-01T00:00:00Z', utcIsoTimestamp(0));
    }

    #[Test]
    public function parseUtcDbDateTimeIgnoresPhpDefaultTimezone(): void
    {
        date_default_timezone_set('Australia/Adelaide');

        $this->assertSame(0, parseUtcDbDateTime('1970-01-01 00:00:00'));
    }

    #[Test]
    public function parseUtcDbDateTimeRejectsInvalidValues(): void
    {
        $this->assertNull(parseUtcDbDateTime('not-a-date'));
        $this->assertNull(parseUtcDbDateTime('2026-99-99 00:00:00'));
    }
}
