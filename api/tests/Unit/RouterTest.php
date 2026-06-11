<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

final class RouterTest extends TestCase
{
    #[Test]
    public function normalizesRequestUriToApiPath(): void
    {
        $this->assertSame('/api/projects', normalizeApiPath('/api/projects/?x=1'));
        $this->assertSame('/', normalizeApiPath('/'));
    }

    public static function routeProvider(): array
    {
        return [
            'send-code' => ['POST', '/api/auth/send-code', 'auth.send-code', API_BODY_JSON, null],
            'verify-code' => ['POST', '/api/auth/verify-code', 'auth.verify-code', API_BODY_JSON, null],
            'logout' => ['POST', '/api/auth/logout', 'auth.logout', API_BODY_NONE, null],
            'me' => ['GET', '/api/auth/me', 'auth.me', API_BODY_NONE, null],
            'create project' => ['POST', '/api/projects', 'projects.create', API_BODY_JSON, null],
            'list projects' => ['GET', '/api/projects', 'projects.list', API_BODY_NONE, null],
            'get project' => ['GET', '/api/projects/AbCdEfGhIjKl', 'projects.get', API_BODY_NONE, 'AbCdEfGhIjKl'],
            'get project meta' => ['GET', '/api/projects/AbCdEfGhIjKl/meta', 'projects.meta', API_BODY_NONE, 'AbCdEfGhIjKl'],
            'update project' => ['PUT', '/api/projects/AbCdEfGhIjKl', 'projects.update', API_BODY_JSON, 'AbCdEfGhIjKl'],
            'patch project' => ['PATCH', '/api/projects/AbCdEfGhIjKl', 'projects.patch', API_BODY_JSON, 'AbCdEfGhIjKl'],
            'delete project' => ['DELETE', '/api/projects/AbCdEfGhIjKl', 'projects.delete', API_BODY_NONE, 'AbCdEfGhIjKl'],
        ];
    }

    #[Test]
    #[DataProvider('routeProvider')]
    public function resolvesRouteBodyPolicyAndProjectId(
        string $method,
        string $path,
        string $expectedName,
        string $expectedBodyPolicy,
        ?string $expectedProjectId,
    ): void {
        $route = resolveApiRoute($method, $path);

        $this->assertSame($expectedName, $route['name']);
        $this->assertSame($expectedBodyPolicy, $route['bodyPolicy']);
        $this->assertSame($expectedProjectId, $route['projectId']);
        $this->assertNull($route['response']);
    }

    #[Test]
    public function resolvesUnknownPostWithoutJsonBodyPolicy(): void
    {
        $route = resolveApiRoute('POST', '/api/not-a-route');

        $this->assertSame('error', $route['name']);
        $this->assertSame(API_BODY_NONE, $route['bodyPolicy']);
        $this->assertInstanceOf(ApiResponse::class, $route['response']);
        $this->assertSame(404, $route['response']->status);
    }

    #[Test]
    public function resolvesProjectMetaMethodNotAllowedWithoutJsonBodyPolicy(): void
    {
        foreach (['POST', 'PUT', 'PATCH', 'DELETE'] as $method) {
            $route = resolveApiRoute($method, '/api/projects/AbCdEfGhIjKl/meta');

            $this->assertSame('error', $route['name']);
            $this->assertSame(API_BODY_NONE, $route['bodyPolicy']);
            $this->assertInstanceOf(ApiResponse::class, $route['response']);
            $this->assertSame(405, $route['response']->status);
            $this->assertSame('GET, OPTIONS', $route['response']->headers['Allow']);
        }
    }

    #[Test]
    public function resolvesProjectCollectionMethodNotAllowedWithoutJsonBodyPolicy(): void
    {
        $route = resolveApiRoute('PUT', '/api/projects');

        $this->assertSame('error', $route['name']);
        $this->assertSame(API_BODY_NONE, $route['bodyPolicy']);
        $this->assertInstanceOf(ApiResponse::class, $route['response']);
        $this->assertSame(405, $route['response']->status);
        $this->assertSame('GET, POST, OPTIONS', $route['response']->headers['Allow']);
    }
}
