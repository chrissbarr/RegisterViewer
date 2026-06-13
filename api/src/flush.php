<?php

declare(strict_types=1);

/**
 * SAPI functions that flush the response to the client and release the
 * worker before shutdown functions run, in preference order: PHP-FPM first
 * (preserves existing behavior), then LiteSpeed — LSAPI 7.3.1 dropped the
 * fastcgi_finish_request() alias, leaving only litespeed_finish_request().
 *
 * @return list<string>
 */
function responseFinisherCandidates(): array
{
    return ['fastcgi_finish_request', 'litespeed_finish_request'];
}

/**
 * Flush the response to the client via the first available SAPI finisher.
 *
 * Silent no-op when none exists (CLI, mod_php): the response is still sent
 * at exit, but the worker is held until shutdown functions complete.
 */
function flushResponseToClient(): void
{
    foreach (responseFinisherCandidates() as $finisher) {
        if (function_exists($finisher)) {
            $finisher();
            return;
        }
    }
}
