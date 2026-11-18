<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\System\Http\DocsController;
use App\Support\Observability\OpenApi;
use Tests\TestCase;

final class OpenApiTest extends TestCase
{
    public function test_operations_document_only_errors_their_pipeline_returns(): void
    {
        $paths = app(OpenApi::class)->generate()['paths'];
        $errors = static fn(
            string $path,
            string $method,
        ): array => array_values(
            self::sorted(
                array_filter(
                    array_map(
                        'intval',
                        array_keys($paths[$path][$method]['responses']),
                    ),
                    static fn(int $code): bool => $code >= 400,
                ),
            ),
        );
        self::assertSame([500, 503], $errors('/ready', 'get'));
        self::assertSame([500], $errors('/live', 'get'));
        self::assertSame(
            [401, 403, 422, 429, 500],
            $errors('/api/users', 'get'),
        );
        self::assertContains(404, $errors('/api/users/{id}', 'get'));
        self::assertNotContains(403, $errors('/api/auth/login', 'post'));
        self::assertContains(401, $errors('/api/auth/login', 'post'));
    }

    public function test_docs_ui_pins_scalar_with_subresource_integrity(): void
    {
        $html = new DocsController(app(OpenApi::class))->ui()->getContent();
        self::assertIsString($html);
        self::assertMatchesRegularExpression(
            '#<script src="https://cdn\.jsdelivr\.net/npm/@scalar/api-reference@\d+\.\d+\.\d+/[^"]+" integrity="sha384-[A-Za-z0-9+/=]{64}" crossorigin="anonymous"></script>#',
            $html,
        );
    }

    public function test_user_list_query_documents_server_defaults(): void
    {
        $parameters = [];
        foreach (
            app(OpenApi::class)->generate()['paths']['/api/users']['get'][
                'parameters'
            ]
            as $parameter
        ) {
            $parameters[$parameter['name']] = $parameter;
        }
        foreach (
            [
                'page' => 1,
                'limit' => 10,
                'sortBy' => 'createdAt',
                'orderBy' => 'desc',
            ]
            as $name => $default
        ) {
            self::assertSame($default, $parameters[$name]['schema']['default']);
            self::assertFalse($parameters[$name]['required'] ?? false);
        }
    }

    public function test_refresh_token_cookie_transport_is_documented(): void
    {
        $paths = app(OpenApi::class)->generate()['paths'];
        foreach (
            [
                '/api/auth/login' => '200',
                '/api/auth/refresh' => '200',
                '/api/auth/logout' => '204',
            ]
            as $path => $status
        ) {
            $operation = $paths[$path]['post'];
            self::assertStringContainsString(
                'REFRESH_TOKEN_TRANSPORT',
                $operation['description'],
            );
            self::assertArrayHasKey(
                'Set-Cookie',
                $operation['responses'][$status]['headers'],
            );
            $headers = array_values(
                array_filter(
                    $operation['parameters'] ?? [],
                    static fn(array $parameter): bool => $parameter['name'] ===
                        'X-Requested-With',
                ),
            );
            if ($path === '/api/auth/login') {
                self::assertSame([], $headers);

                continue;
            }
            self::assertSame('header', $headers[0]['in']);
            self::assertFalse($headers[0]['required'] ?? false);
            self::assertArrayHasKey('400', $operation['responses']);
            self::assertArrayHasKey('403', $operation['responses']);
        }
    }

    public function test_native_requests_resources_and_envelopes_have_concrete_public_schemas_without_a_database(): void
    {
        $spec = app(OpenApi::class)->generate();
        self::assertGreaterThanOrEqual(
            33,
            count(
                array_merge(
                    ...array_values(
                        array_map(array_values(...), $spec['paths']),
                    ),
                ),
            ),
        );
        $schemas = $spec['components']['schemas'];
        self::assertSame(
            ['id', 'email', 'roleId', 'createdAt', 'updatedAt'],
            array_keys($schemas['AuthUserResource']['properties']),
        );
        self::assertSame(
            ['id', 'originalName', 'mimeType', 'size', 'createdAt'],
            array_keys($schemas['StoredFileResource']['properties']),
        );
        self::assertSame(
            [
                'id',
                'recipientId',
                'title',
                'body',
                'emailStatus',
                'readAt',
                'createdAt',
            ],
            array_keys($schemas['NotificationResource']['properties']),
        );
        $register = $spec['paths']['/api/auth/register']['post'];
        self::assertSame(
            '#/components/schemas/AuthUserResource',
            $register['responses']['201']['content']['application/json'][
                'schema'
            ]['properties']['data']['$ref'],
        );
        self::assertArrayHasKey(
            'success',
            $register['responses']['422']['content']['application/json'][
                'schema'
            ]['properties'],
        );
        self::assertSame([], $register['security']);
        self::assertSame(
            [['bearerAuth' => []]],
            $spec['paths']['/api/users']['get']['security'],
        );
        self::assertArrayHasKey(
            'email',
            $spec['paths']['/api/users']['get']['responses']['200']['content'][
                'application/json'
            ]['schema']['properties']['data']['items']['properties'],
        );
        self::assertArrayHasKey(
            'application/octet-stream',
            $spec['paths']['/api/upload/{id}']['get']['responses']['200'][
                'content'
            ],
        );
        self::assertArrayHasKey(
            'text/event-stream',
            $spec['paths']['/api/notifications/stream']['get']['responses'][
                '200'
            ]['content'],
        );
        self::assertSame(
            ['email', 'password'],
            $schemas['RegisterRequest']['required'],
        );
    }

    /**
     * @param  array<int, int>  $codes
     * @return array<int, int>
     */
    private static function sorted(array $codes): array
    {
        sort($codes);

        return $codes;
    }
}
