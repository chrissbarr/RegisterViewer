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
    $apiKey = $config['resend_api_key'] ?? '';
    if ($apiKey === '') {
        error_log('sendLoginCode: RESEND_API_KEY not configured');
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

    if ($response === false) {
        error_log('sendLoginCode: Resend API request failed (network error)');
        return false;
    }

    // Check HTTP status from response headers
    $status = parseHttpStatusCode($http_response_header ?? []);
    if ($status !== null && $status >= 200 && $status < 300) {
        return true;
    }
    if ($status !== null) {
        error_log("sendLoginCode: Resend API returned HTTP $status: " . substr($response, 0, 200));
    } else {
        error_log('sendLoginCode: Could not determine HTTP status');
    }
    return false;
}
