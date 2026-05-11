<?php

declare(strict_types=1);

/**
 * Data-access facade — requires domain-specific query files.
 *
 * Split into per-domain files for maintainability (CQ-N04).
 * This file is kept so that existing require statements in index.php
 * and tests/bootstrap.php continue to work unchanged.
 *
 * Domain files:
 *   data-access/projects.php    — projects table (13 functions)
 *   data-access/users.php       — users table (4 functions)
 *   data-access/login-codes.php — login_codes table + OTP constants
 *   data-access/auth-rate-limits.php — fixed-window auth rate-limit buckets
 *   data-access/tokens.php      — revoked_tokens table (3 functions)
 */

require __DIR__ . '/data-access/projects.php';
require __DIR__ . '/data-access/users.php';
require __DIR__ . '/data-access/login-codes.php';
require __DIR__ . '/data-access/auth-rate-limits.php';
require __DIR__ . '/data-access/tokens.php';
