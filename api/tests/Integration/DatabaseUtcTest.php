<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class DatabaseUtcTest extends TestCase
{
    private function config(): array
    {
        return [
            'db' => [
                'host' => getenv('DB_HOST') ?: '127.0.0.1',
                'port' => (int) (getenv('DB_PORT') ?: 3306),
                'database' => getenv('DB_DATABASE') ?: 'register_viewer',
                'username' => getenv('DB_USERNAME') ?: 'regapi',
                'password' => getenv('DB_PASSWORD') ?: 'regapi_dev',
                'charset' => 'utf8mb4',
            ],
        ];
    }

    #[Test]
    public function getDatabaseSetsSessionTimezoneToUtc(): void
    {
        $db = getDatabase($this->config());

        $this->assertSame('+00:00', $db->query('SELECT @@session.time_zone')->fetchColumn());

        $diff = (int) $db->query(
            'SELECT ABS(TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(), UTC_TIMESTAMP()))'
        )->fetchColumn();
        $this->assertLessThanOrEqual(1, $diff);
    }
}
