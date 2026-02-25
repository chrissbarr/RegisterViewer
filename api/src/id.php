<?php

declare(strict_types=1);

/**
 * Generate a 12-character base62 ID using random_bytes().
 * Uses rejection sampling to avoid modulo bias (same algorithm as worker/src/id.ts).
 */
function generatePublicId(): string
{
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    $length = 12;
    $result = '';

    while (strlen($result) < $length) {
        $bytes = random_bytes($length * 2);
        for ($i = 0; $i < strlen($bytes) && strlen($result) < $length; $i++) {
            $byte = ord($bytes[$i]);
            // Reject values >= 248 to avoid modulo bias (248 = 62 * 4)
            if ($byte < 248) {
                $result .= $chars[$byte % 62];
            }
        }
    }

    return $result;
}
