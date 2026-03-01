<?php

declare(strict_types=1);

/**
 * Send a login OTP code via email.
 *
 * Builds the OTP message and delegates to sendEmail() for transport.
 *
 * @return bool True if the email was accepted by the provider, false otherwise.
 */
function sendLoginCode(array $config, string $email, string $code): bool
{
    return sendEmail(
        $config,
        $email,
        'Your Register Viewer login code',
        "Your Register Viewer login code is: $code\n\nIt expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.",
    );
}

/**
 * Send an email via the configured provider (currently Resend).
 *
 * Uses cURL for reliable HTTP transport with direct status code access.
 * To swap providers, rewrite the body of this function — the rest of the
 * codebase calls sendLoginCode() / sendEmail() and is unaffected.
 *
 * @return bool True if the provider returned 2xx, false otherwise.
 */
function sendEmail(array $config, string $to, string $subject, string $text): bool
{
    $startTime = microtime(true);
    $apiKey = $config['resend_api_key'] ?? '';
    if ($apiKey === '') {
        error_log(json_encode([
            'event' => 'email_send_failed',
            'reason' => 'missing_api_key',
            'timestamp' => gmdate('c'),
        ]));
        return false;
    }

    $from = $config['resend_from_email'] ?? 'noreply@registerviewer.com';

    $body = json_encode([
        'from'    => "Register Viewer <$from>",
        'to'      => [$to],
        'subject' => $subject,
        'text'    => $text,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.resend.com/emails');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            "Authorization: Bearer $apiKey",
        ],
        CURLOPT_RETURNTRANSFER  => true,
        CURLOPT_CONNECTTIMEOUT  => 3,
        CURLOPT_TIMEOUT         => 5,
    ]);

    $response = curl_exec($ch);
    $durationMs = (int) ((microtime(true) - $startTime) * 1000);

    if ($response === false) {
        $curlError = curl_error($ch);
        curl_close($ch);
        error_log(json_encode([
            'event' => 'email_send_failed',
            'reason' => 'network_error',
            'detail' => $curlError,
            'duration_ms' => $durationMs,
            'timestamp' => gmdate('c'),
        ]));
        return false;
    }

    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($status >= 200 && $status < 300) {
        error_log(json_encode([
            'event' => 'email_sent',
            'duration_ms' => $durationMs,
            'timestamp' => gmdate('c'),
        ]));
        return true;
    }

    error_log(json_encode([
        'event' => 'email_send_failed',
        'reason' => "http_$status",
        'duration_ms' => $durationMs,
        'timestamp' => gmdate('c'),
    ]));
    return false;
}

/**
 * Check whether the email provider is reachable and properly configured.
 *
 * Currently validates the Resend API key via GET /api-keys (no email sent).
 * To swap providers, rewrite this function body alongside sendEmail().
 *
 * @return array{ok: bool, error?: string} Health status.
 */
function checkEmailHealth(array $config): array
{
    $apiKey = $config['resend_api_key'] ?? '';
    if ($apiKey === '') {
        return ['ok' => false, 'error' => 'resend_api_key not configured'];
    }

    $ch = curl_init('https://api.resend.com/api-keys');
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER      => ["Authorization: Bearer $apiKey"],
        CURLOPT_RETURNTRANSFER  => true,
        CURLOPT_CONNECTTIMEOUT  => 2,
        CURLOPT_TIMEOUT         => 3,
    ]);

    $response = curl_exec($ch);

    if ($response === false) {
        $curlError = curl_error($ch);
        curl_close($ch);
        return ['ok' => false, 'error' => "Email provider unreachable: $curlError"];
    }

    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($status >= 200 && $status < 300) {
        return ['ok' => true];
    }

    return ['ok' => false, 'error' => "Email provider returned HTTP $status"];
}
