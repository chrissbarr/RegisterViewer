<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class FlushTest extends TestCase
{
    #[Test]
    public function finisherCandidatesAreFpmThenLitespeedInOrder(): void
    {
        $this->assertSame(
            ['fastcgi_finish_request', 'litespeed_finish_request'],
            responseFinisherCandidates(),
        );
    }

    #[Test]
    public function flushIsSilentNoOpWhenNoFinisherExists(): void
    {
        // Under the CLI SAPI (where PHPUnit runs) neither finisher function
        // exists, so flushResponseToClient() must do nothing — no warnings,
        // no exceptions.
        $this->assertFalse(function_exists('fastcgi_finish_request'));
        $this->assertFalse(function_exists('litespeed_finish_request'));
        flushResponseToClient();
        $this->addToAssertionCount(1); // reached without error
    }
}
