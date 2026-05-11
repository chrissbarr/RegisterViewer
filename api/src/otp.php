<?php

declare(strict_types=1);

const OTP_HASH_SECRET_MIN_LENGTH = 32;
const OTP_VERIFIER_CONTEXT = "register-viewer:login-otp:v1";

function isOtpHashSecretConfigured(array $config): bool
{
    return isset($config['otp_hash_secret'])
        && is_string($config['otp_hash_secret'])
        && strlen($config['otp_hash_secret']) >= OTP_HASH_SECRET_MIN_LENGTH;
}

function requireOtpHashSecret(array $config): string
{
    if (!isOtpHashSecretConfigured($config)) {
        throw new RuntimeException('OTP hash secret must be at least 32 characters');
    }

    return $config['otp_hash_secret'];
}

function createOtpVerifier(array $config, string $email, string $code): string
{
    return hash_hmac(
        'sha256',
        OTP_VERIFIER_CONTEXT . "\0" . $email . "\0" . $code,
        requireOtpHashSecret($config)
    );
}

function verifyOtpCode(array $config, string $email, string $code, string $storedVerifier): bool
{
    if (!preg_match('/^[0-9a-f]{64}$/', $storedVerifier)) {
        return false;
    }

    return hash_equals($storedVerifier, createOtpVerifier($config, $email, $code));
}
