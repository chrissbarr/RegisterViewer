<?php

declare(strict_types=1);

/**
 * Parse the HTTP status code from a $http_response_header array.
 *
 * @param list<string> $responseHeaders The $http_response_header magic variable.
 * @return int|null The status code, or null if unparseable.
 */
function parseHttpStatusCode(array $responseHeaders): ?int
{
    $statusLine = $responseHeaders[0] ?? '';
    if (preg_match('/\s(\d{3})\s/', $statusLine, $matches)) {
        return (int) $matches[1];
    }
    return null;
}

/**
 * Send a login OTP code via the Resend API.
 *
 * Uses file_get_contents with a stream context (no curl dependency).
 *
 * @return bool True if the API returned 2xx, false otherwise.
 */
function sendLoginCode(array $config, string $email, string $code): bool
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
        'to'      => [$email],
        'subject' => 'Your Register Viewer login code',
        'text'    => "Your Register Viewer login code is: $code\n\nIt expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.",
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    $context = stream_context_create([
        'http' => [
            'method'  => 'POST',
            'header'  => implode("\r\n", [
                'Content-Type: application/json',
                "Authorization: Bearer $apiKey",
                'Content-Length: ' . strlen($body),
            ]),
            'content' => $body,
            'timeout' => 5,
            'ignore_errors' => true,
        ],
    ]);

    $response = @file_get_contents('https://api.resend.com/emails', false, $context);
    $durationMs = (int) ((microtime(true) - $startTime) * 1000);

    if ($response === false) {
        error_log(json_encode([
            'event' => 'email_send_failed',
            'reason' => 'network_error',
            'duration_ms' => $durationMs,
            'timestamp' => gmdate('c'),
        ]));
        return false;
    }

    // Check HTTP status from response headers
    $status = parseHttpStatusCode($http_response_header ?? []);
    if ($status !== null && $status >= 200 && $status < 300) {
        error_log(json_encode([
            'event' => 'email_sent',
            'duration_ms' => $durationMs,
            'timestamp' => gmdate('c'),
        ]));
        return true;
    }

    error_log(json_encode([
        'event' => 'email_send_failed',
        'reason' => $status !== null ? "http_$status" : 'unknown_status',
        'response' => substr($response, 0, 200),
        'duration_ms' => $durationMs,
        'timestamp' => gmdate('c'),
    ]));
    return false;
}

/**
 * Check whether the Resend API is reachable and the API key is valid.
 *
 * Calls GET https://api.resend.com/api-keys with a short timeout.
 * Does NOT send any email — purely a connectivity/auth check.
 *
 * @return array{ok: bool, error?: string} Health status.
 */
function checkResendApiHealth(array $config): array
{
    $apiKey = $config['resend_api_key'] ?? '';
    if ($apiKey === '') {
        return ['ok' => false, 'error' => 'resend_api_key not configured'];
    }

    $context = stream_context_create([
        'http' => [
            'method'  => 'GET',
            'header'  => "Authorization: Bearer $apiKey",
            'timeout' => 3,
            'ignore_errors' => true,
        ],
    ]);

    // Note: $response contains the list of API keys for the account.
    // Only the HTTP status is used — never forward $response to callers.
    $response = @file_get_contents('https://api.resend.com/api-keys', false, $context);

    if ($response === false) {
        return ['ok' => false, 'error' => 'Resend API unreachable'];
    }

    $status = parseHttpStatusCode($http_response_header ?? []);
    if ($status !== null && $status >= 200 && $status < 300) {
        return ['ok' => true];
    }

    return ['ok' => false, 'error' => "Resend API returned HTTP $status"];
}
