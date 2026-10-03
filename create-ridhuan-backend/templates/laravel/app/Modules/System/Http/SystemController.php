<?php

declare(strict_types=1);

namespace App\Modules\System\Http;

use App\Support\Config\Settings;
use App\Support\Http\Api;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Throwable;

final class SystemController
{
    public function get(): JsonResponse
    {
        if (request()->route()?->getName() === 'ready.get') {
            try {
                Settings::validate();
                DB::select('SELECT 1');
                if (Settings::string('backend.rate.store') === 'redis') {
                    Redis::connection()->ping();
                }
            } catch (Throwable) {
                return response()->json(
                    [
                        'success' => false,
                        'message' => 'Required dependency unavailable',
                    ],
                    503,
                );
            }
        }

        return Api::data(['status' => 'ok']);
    }
}
