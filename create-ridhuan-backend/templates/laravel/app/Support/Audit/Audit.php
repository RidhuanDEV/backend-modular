<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Support\Endpoint\EndpointRegistry;
use App\Support\Time\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

final class Audit
{
    public function __construct(private readonly Clock $clock, private readonly EndpointRegistry $registry) {}

    /**
     * @param  array<string, scalar|null|array<array-key, mixed>>|null  $before
     * @param  array<string, scalar|null|array<array-key, mixed>>|null  $after
     */
    public function write(string $behavior, string $module, ?string $entity, ?string $actor, ?array $before = null, ?array $after = null): void
    {
        $endpoint = request()->route()?->getName();
        $mode = $endpoint === null ? 'required' : $this->registry->get($endpoint)->audit;
        if ($mode === 'none') {
            return;
        }
        $insert = function () use ($behavior, $module, $entity, $actor, $before, $after, $endpoint): void {
            DB::table('activity_logs')->insert(['id' => Str::uuid()->toString(), 'behavior' => $behavior, 'module' => $module, 'entity_id' => $entity, 'user_id' => $actor, 'actor_id_snapshot' => $actor, 'before' => $before === null ? null : json_encode($this->redact($before), JSON_THROW_ON_ERROR), 'after' => $after === null ? null : json_encode($this->redact($after), JSON_THROW_ON_ERROR), 'endpoint_id' => $endpoint, 'request_id' => request()->attributes->get('requestId'), 'created_at' => $this->clock->now(), 'updated_at' => $this->clock->now()]);
        };
        if ($mode === 'required') {
            $insert();

            return;
        }
        // Nested native transaction creates a savepoint, including on PostgreSQL.
        try {
            DB::transaction($insert);
        } catch (Throwable $error) {
            Log::warning('optional_audit_failed', ['type' => $error::class]);
        }
    }

    /**
     * @param  array<array-key, mixed>  $value
     * @return array<array-key, mixed>
     */
    private function redact(array $value): array
    {
        $output = [];
        foreach ($value as $key => $item) {
            if (is_string($key) && preg_match('/password|secret|token|authorization|recipient|email|body/i', $key)) {
                continue;
            }
            $output[$key] = is_array($item) ? $this->redact($item) : (is_scalar($item) || $item === null ? $item : '[redacted]');
        }

        return $output;
    }
}
