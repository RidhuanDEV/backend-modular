<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Support\Observability\OpenApi;
use Tests\TestCase;

final class OpenApiTest extends TestCase
{
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
}
