<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;

final class RouteDispatchTest extends TestCase
{
    private static ?PDO $db = null;
    private const CONFIG = [
        'jwt_secret' => 'test-jwt-secret-not-for-production',
        'otp_hash_secret' => 'test-otp-hash-secret-not-for-production',
        'app_url' => 'http://localhost',
    ];

    public static function setUpBeforeClass(): void
    {
        $host = getenv('DB_HOST') ?: '127.0.0.1';
        $port = (int) (getenv('DB_PORT') ?: 3306);
        $database = getenv('DB_DATABASE') ?: 'register_viewer';
        $username = getenv('DB_USERNAME') ?: 'regapi';
        $password = getenv('DB_PASSWORD') ?: 'regapi_dev';

        $dsn = "mysql:host=$host;port=$port;dbname=$database;charset=utf8mb4";
        self::$db = new PDO($dsn, $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }

    protected function setUp(): void
    {
        date_default_timezone_set('UTC');
        self::$db->exec("SET SESSION time_zone = '+00:00'");
        self::$db->exec('DELETE FROM projects');
        self::$db->exec('DELETE FROM auth_rate_limits');
        self::$db->exec('DELETE FROM login_codes');
        self::$db->exec('DELETE FROM users');
        self::$db->exec('DELETE FROM revoked_tokens');
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$db !== null) {
            self::$db->exec('DELETE FROM projects');
            self::$db->exec('DELETE FROM auth_rate_limits');
            self::$db->exec('DELETE FROM login_codes');
            self::$db->exec('DELETE FROM users');
            self::$db->exec('DELETE FROM revoked_tokens');
            self::$db = null;
        }
    }

    private function dispatch(
        string $method,
        string $requestUri,
        string $body = '',
        ?string $jwt = null,
        ?int &$bodyReads = null,
    ): ApiResponse {
        $bodyReads = 0;
        $previousAuth = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
        $previousRedirectAuth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null;

        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
        if ($jwt !== null) {
            $_SERVER['HTTP_AUTHORIZATION'] = "Bearer $jwt";
        }

        try {
            return dispatchApiRoute(
                self::$db,
                self::CONFIG,
                $method,
                normalizeApiPath($requestUri),
                [
                    'REQUEST_METHOD' => $method,
                    'REQUEST_URI' => $requestUri,
                    'CONTENT_LENGTH' => (string) strlen($body),
                ],
                function () use (&$bodyReads, $body): string {
                    $bodyReads++;
                    return $body;
                }
            );
        } finally {
            if ($previousAuth === null) {
                unset($_SERVER['HTTP_AUTHORIZATION']);
            } else {
                $_SERVER['HTTP_AUTHORIZATION'] = $previousAuth;
            }
            if ($previousRedirectAuth === null) {
                unset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
            } else {
                $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] = $previousRedirectAuth;
            }
        }
    }

    private function createJwtForUser(string $email): string
    {
        $userId = dbCreateUser(self::$db, $email);
        return createJwt(self::CONFIG, $userId, $email);
    }

    private function seedLoginCode(string $email, string $code = '123456', bool $legacySha256 = false): void
    {
        $verifier = $legacySha256
            ? hash('sha256', $code)
            : createOtpVerifier(self::CONFIG, $email, $code);
        dbCreateLoginCode(self::$db, $email, $verifier, gmdate('Y-m-d H:i:s', time() + 600));
    }

    #[Test]
    public function logoutWithEmptyBodyRevokesJwtWithoutReadingBody(): void
    {
        $email = 'logout-route@example.com';
        $userId = dbCreateUser(self::$db, $email);
        $token = createJwt(self::CONFIG, $userId, $email);
        $payload = verifyJwt(self::CONFIG, $token);

        $response = $this->dispatch('POST', '/api/auth/logout', '', $token, $bodyReads);

        $this->assertSame(204, $response->status);
        $this->assertSame(0, $bodyReads);
        $this->assertTrue(dbIsTokenRevoked(self::$db, $payload['jti']));

        $meResponse = $this->dispatch('GET', '/api/auth/me', '', $token, $bodyReads);
        $this->assertSame(401, $meResponse->status);
        $this->assertSame(0, $bodyReads);
    }

    #[Test]
    public function logoutWithoutAuthReturns401WithoutReadingBody(): void
    {
        $response = $this->dispatch('POST', '/api/auth/logout', '', null, $bodyReads);

        $this->assertSame(401, $response->status);
        $this->assertSame(0, $bodyReads);
    }

    #[Test]
    public function unknownPostRouteDoesNotReadOrParseBody(): void
    {
        $response = $this->dispatch('POST', '/api/not-a-route', '{not-json', null, $bodyReads);

        $this->assertSame(404, $response->status);
        $this->assertSame(0, $bodyReads);
        $this->assertSame('Not found', $response->body['error']);
    }

    #[Test]
    public function projectMethodNotAllowedDoesNotReadBody(): void
    {
        $response = $this->dispatch('PUT', '/api/projects', '{not-json', null, $bodyReads);

        $this->assertSame(405, $response->status);
        $this->assertSame(0, $bodyReads);
        $this->assertSame('GET, POST, OPTIONS', $response->headers['Allow']);
    }

    #[Test]
    public function projectResourceMethodNotAllowedDoesNotReadBody(): void
    {
        $response = $this->dispatch('POST', '/api/projects/AbCdEfGhIjKl', '{not-json', null, $bodyReads);

        $this->assertSame(405, $response->status);
        $this->assertSame(0, $bodyReads);
        $this->assertSame('GET, PUT, PATCH, DELETE, OPTIONS', $response->headers['Allow']);
    }

    #[Test]
    public function jsonBodyRouteStillRejectsEmptyBody(): void
    {
        $response = $this->dispatch('POST', '/api/auth/send-code', '', null, $bodyReads);

        $this->assertSame(400, $response->status);
        $this->assertSame(1, $bodyReads);
        $this->assertSame('Invalid JSON body', $response->body['error']);
    }

    #[Test]
    public function verifyCodeRouteAcceptsHmacVerifier(): void
    {
        $email = 'verify-route@example.com';
        $this->seedLoginCode($email, '123456');

        $response = $this->dispatch(
            'POST',
            '/api/auth/verify-code',
            json_encode(['email' => $email, 'code' => '123456'], JSON_THROW_ON_ERROR),
            null,
            $bodyReads
        );

        $this->assertSame(200, $response->status);
        $this->assertSame(1, $bodyReads);
        $this->assertArrayHasKey('token', $response->body);
        $payload = verifyJwt(self::CONFIG, $response->body['token']);
        $this->assertNotNull($payload);
        $this->assertSame($email, $payload['email']);
    }

    #[Test]
    public function verifyCodeRouteRejectsLegacySha256Verifier(): void
    {
        $email = 'verify-route-legacy@example.com';
        $this->seedLoginCode($email, '123456', legacySha256: true);

        $response = $this->dispatch(
            'POST',
            '/api/auth/verify-code',
            json_encode(['email' => $email, 'code' => '123456'], JSON_THROW_ON_ERROR),
            null,
            $bodyReads
        );

        $this->assertSame(401, $response->status);
        $this->assertSame(1, $bodyReads);
        $this->assertNull(dbGetUserByEmail(self::$db, $email));
    }

    #[Test]
    public function protectedJsonRouteRejectsNoAuthBeforeReadingBody(): void
    {
        $response = $this->dispatch('POST', '/api/projects', '', null, $bodyReads);

        $this->assertSame(401, $response->status);
        $this->assertSame(0, $bodyReads);
        $this->assertSame('Authentication required', $response->body['error']);
    }

    #[Test]
    public function authenticatedCreateProjectRejectsMalformedJsonAfterAuth(): void
    {
        $jwt = $this->createJwtForUser('create-malformed@example.com');

        $response = $this->dispatch('POST', '/api/projects', '{not-json', $jwt, $bodyReads);

        $this->assertSame(400, $response->status);
        $this->assertSame(1, $bodyReads);
        $this->assertSame('Invalid JSON body', $response->body['error']);
    }

    #[Test]
    public function authenticatedUpdateProjectRejectsEmptyBodyAfterOwnership(): void
    {
        $email = 'update-empty@example.com';
        $userId = dbCreateUser(self::$db, $email);
        $jwt = createJwt(self::CONFIG, $userId, $email);
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', '{"version":1,"registers":[{"name":"CTRL","width":8,"fields":[]}],"registerValues":{}}', null, $userId);

        $response = $this->dispatch('PUT', "/api/projects/$id", '', $jwt, $bodyReads);

        $this->assertSame(400, $response->status);
        $this->assertSame(1, $bodyReads);
        $this->assertSame('Invalid JSON body', $response->body['error']);
    }

    #[Test]
    public function authenticatedPatchProjectRejectsMalformedJsonAfterOwnership(): void
    {
        $email = 'patch-malformed@example.com';
        $userId = dbCreateUser(self::$db, $email);
        $jwt = createJwt(self::CONFIG, $userId, $email);
        $id = generatePublicId();
        dbCreateProject(self::$db, $id, 'private', '{"version":1,"registers":[{"name":"CTRL","width":8,"fields":[]}],"registerValues":{}}', null, $userId);

        $response = $this->dispatch('PATCH', "/api/projects/$id", '{not-json', $jwt, $bodyReads);

        $this->assertSame(400, $response->status);
        $this->assertSame(1, $bodyReads);
        $this->assertSame('Invalid JSON body', $response->body['error']);
    }
}
