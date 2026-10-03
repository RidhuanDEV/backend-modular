<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Http;

use App\Infrastructure\RateLimit\StreamSlots;
use App\Modules\Auth\Services\Actor;
use App\Modules\Notifications\Http\Requests\CreateNotificationRequest;
use App\Modules\Notifications\Http\Resources\NotificationResource;
use App\Modules\Notifications\Models\Notification;
use App\Modules\Notifications\Services\NotificationService;
use App\Support\Config\Settings;
use App\Support\Http\Api;
use App\Support\Http\ApiException;
use App\Support\Observability\Telemetry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

final class NotificationController
{
    public function __construct(
        private readonly NotificationService $service,
        private readonly Actor $actor,
        private readonly StreamSlots $slots,
    ) {}

    public function create(CreateNotificationRequest $request): JsonResponse
    {
        return Api::resource(
            new NotificationResource(
                $this->service->create($request->dto(), $this->actor->user()),
            ),
            201,
        );
    }

    public function read(string $id): JsonResponse
    {
        return Api::resource(
            new NotificationResource(
                $this->service->read($id, $this->actor->user()),
            ),
        );
    }

    public function list(Request $request): JsonResponse
    {
        $cursor = $request->query('cursor');
        if ($cursor !== null && !is_string($cursor)) {
            throw new ApiException(400, 'Invalid cursor');
        }
        $actor = $this->actor->user();
        $items = $this->service->page(
            $actor,
            $this->service->cursor($actor, $cursor),
        );
        $response = Api::data(
            $items
                ->take(50)
                ->map(
                    fn(Notification $n): array => new NotificationResource(
                        $n,
                    )->toArray(request()),
                )
                ->all(),
        );
        if ($items->count() > 50) {
            $last = $items->get(49);
            if ($last === null) {
                throw new \LogicException('Missing page cursor');
            }
            $response->headers->set('X-Next-Cursor', $last->id);
        }

        return $response;
    }

    public function stream(Request $request): StreamedResponse
    {
        $actor = $this->actor->user();
        $cursor = $request->header('Last-Event-ID');
        $after = $this->service->cursor($actor, $cursor);
        $expiry = $request->attributes->get('accessExpiry');
        if (!is_int($expiry)) {
            throw new ApiException(401, 'Missing access expiry');
        }
        // Validation and admission happen before response headers.
        $handle = $this->slots->acquire();
        $deadline = min(
            time() + Settings::integer('backend.sse.seconds', 1, 840),
            $expiry,
        );
        $requestId = $request->attributes->get('requestId');
        if (!is_string($requestId)) {
            flock($handle, LOCK_UN);
            fclose($handle);
            throw new \LogicException('Missing request context');
        }

        return response()->stream(
            function () use (
                $actor,
                $after,
                $cursor,
                $handle,
                $deadline,
                $requestId,
            ): void {
                $telemetry = app(Telemetry::class);
                $scope = $telemetry->start('sse.connection');
                Log::shareContext([
                    'requestId' => $requestId,
                    'operation' => 'notification.stream',
                    'traceId' => $scope?->span->getContext()->getTraceId(),
                ]);
                $started = microtime(true);
                $status = 200;
                $telemetry->event('sse.opened');
                ignore_user_abort(true);
                set_time_limit(0);
                $last = $after;
                $heartbeat = time();
                try {
                    while (time() < $deadline && !connection_aborted()) {
                        $batch = $this->service->batch(
                            $actor,
                            $last,
                            $cursor === null,
                        );
                        DB::disconnect();
                        if ($batch === null) {
                            break;
                        }
                        foreach ($batch as $notification) {
                            $telemetry->event('sse.notification');
                            echo 'id: ' .
                                $notification->id .
                                "\nevent: notification\ndata: " .
                                json_encode(
                                    new NotificationResource(
                                        $notification,
                                    )->toArray(request()),
                                    JSON_THROW_ON_ERROR,
                                ) .
                                "\n\n";
                            $last = $notification->sequence;
                            if (ob_get_level() > 0) {
                                ob_flush();
                            }
                            flush();
                            if (connection_aborted() || time() >= $deadline) {
                                break 2;
                            }
                        }
                        if ($batch->count() === 50) {
                            continue;
                        }
                        if (time() - $heartbeat >= 15) {
                            echo ": heartbeat\n\n";
                            $heartbeat = time();
                            if (ob_get_level() > 0) {
                                ob_flush();
                            }
                            flush();
                        }
                        sleep(Settings::integer('backend.sse.poll', 1, 15));
                    }
                } catch (Throwable $error) {
                    $status = 503;
                    Log::warning('sse_closed', ['type' => $error::class]);
                } finally {
                    $telemetry->event('sse.closed');
                    $telemetry->finish(
                        $scope,
                        'sse.connection',
                        $status,
                        microtime(true) - $started,
                    );
                    Log::flushSharedContext();
                    DB::disconnect();
                    flock($handle, LOCK_UN);
                    fclose($handle);
                }
            },
            200,
            [
                'Content-Type' => 'text/event-stream',
                'Cache-Control' => 'no-cache',
                'X-Accel-Buffering' => 'no',
            ],
        );
    }
}
