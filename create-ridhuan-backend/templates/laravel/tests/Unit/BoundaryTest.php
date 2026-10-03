<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Modules\Auth\Services\JwtService;
use App\Modules\Users\Models\User;
use App\Support\Config\Settings;
use App\Support\Endpoint\EndpointRegistry;
use App\Support\Http\ApiException;
use App\Support\Time\Clock;
use Carbon\CarbonImmutable;
use Firebase\JWT\JWT;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Tests\TestCase;

final class BoundaryTest extends TestCase
{
    public function test_native_unique_conflict_never_exposes_sql_bindings_in_public_error(): void
    {
        $error = new UniqueConstraintViolationException('pgsql', 'INSERT INTO private_table VALUES (?)', ['private-fixture-password'], new \PDOException('fixture database detail'));
        $response = app(ExceptionHandler::class)->render(Request::create('/api/auth/register', 'POST'), $error);
        self::assertSame(409, $response->getStatusCode());
        self::assertSame(['success' => false, 'message' => 'Resource already exists'], json_decode((string) $response->getContent(), true, flags: JSON_THROW_ON_ERROR));
    }

    public function test_generator_invalid_concern_is_a_real_nonzero_exit_and_preserves_registry(): void
    {
        $before = file_get_contents(app_path('Support/Endpoint/EndpointId.php'));
        foreach (['../Escape', 'Auth', 'invoice'] as $name) {
            self::assertSame(1, Artisan::call('make:backend-module', ['name' => $name]));
        }
        self::assertSame($before, file_get_contents(app_path('Support/Endpoint/EndpointId.php')));
    }

    public function test_boolean_false_is_not_truthy_and_invalid_value_is_rejected(): void
    {
        config(['backend.cache' => 'false']);
        self::assertFalse(Settings::boolean('backend.cache'));
        config(['backend.cache' => 'wat']);
        $this->expectException(\InvalidArgumentException::class);
        Settings::boolean('backend.cache');
    }

    public function test_jwt_claims_have_15_minute_expiry_and_check_audience_and_use(): void
    {
        config(['backend.jwt.secret' => str_repeat('a', 96), 'backend.jwt.issuer' => 'fixture', 'backend.jwt.audience' => 'fixture']);
        $user = new User;
        $user->id = Str::uuid()->toString();
        $user->email = 'fixture@example.com';
        $user->role_id = Str::uuid()->toString();
        $jwt = new JwtService(new Clock);
        $signed = $jwt->sign($user);
        $claims = $jwt->verify($signed);
        self::assertSame($user->id, $claims->userId);
        self::assertEqualsWithDelta(time() + 900, $claims->expiresAt, 2);
        $bad = JWT::encode(['sub' => $user->id, 'iat' => time(), 'exp' => time() + 900, 'iss' => 'fixture', 'aud' => 'other', 'tokenUse' => 'access'], str_repeat('a', 96), 'HS256');
        $this->expectException(ApiException::class);
        $jwt->verify($bad);
    }

    public function test_policy_rejects_required_reads_and_cached_streams_and_unknown_ids(): void
    {
        $registry = new EndpointRegistry;
        foreach (['{"user.get":{"audit":"required"}}', '{"notification.stream":{"cache":"read"}}', '{"missing":{"audit":"none"}}', '{"user.get":{"typo":"read"}}'] as $policy) {
            config(['backend.policies' => $policy]);
            try {
                $registry->all();
                self::fail('Invalid policy was accepted');
            } catch (\InvalidArgumentException) {
                self::assertTrue(true);
            }
        }
    }

    public function test_public_contract_registry_covers_source_33_operations(): void
    {
        config(['backend.policies' => '{}']);
        $registry = new EndpointRegistry;
        $registry->verify();
        self::assertGreaterThanOrEqual(33, count($registry->all()));
        $contents = file_get_contents(base_path('contracts/endpoints.json'));
        self::assertIsString($contents);
        $manifest = json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($manifest);
        self::assertCount(33, $manifest['operations']);
        foreach ($manifest['operations'] as $operation) {
            $definition = $registry->get($operation['id']);
            foreach (['method', 'path', 'status', 'authenticated', 'permission', 'audit', 'capability', 'rate', 'cache'] as $field) {
                self::assertSame($operation[$field], $definition->{$field}, $operation['id'].' '.$field);
            }
        }
    }

    public function test_time_instant_is_independent_of_presentation_zone_including_dst(): void
    {
        $instant = CarbonImmutable::parse('2026-03-08T06:30:00Z');
        foreach (['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'America/New_York'] as $zone) {
            self::assertSame($instant->getTimestamp(), $instant->setTimezone($zone)->getTimestamp());
        }
        self::assertSame('03:30', $instant->addHour()->setTimezone('America/New_York')->format('H:i'));
    }
}
