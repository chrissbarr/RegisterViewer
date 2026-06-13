<?php

declare(strict_types=1);

function utcDbDateTime(?int $epoch = null): string
{
    return gmdate('Y-m-d H:i:s', $epoch ?? time());
}

function utcIsoTimestamp(?int $epoch = null): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $epoch ?? time());
}

function parseUtcDbDateTime(string $value): ?int
{
    $dt = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $value, new DateTimeZone('UTC'));
    $errors = DateTimeImmutable::getLastErrors();

    if ($dt === false || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))) {
        return null;
    }

    return $dt->getTimestamp();
}
