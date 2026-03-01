<?php

declare(strict_types=1);

final class ApiResponse
{
    public function __construct(
        public readonly ?array $body,
        public readonly int $status = 200,
        public readonly array $headers = [],
        public readonly ?string $rawJson = null,
    ) {}
}
