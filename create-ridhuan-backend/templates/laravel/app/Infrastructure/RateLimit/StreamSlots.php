<?php

declare(strict_types=1);

namespace App\Infrastructure\RateLimit;

use App\Support\Config\Settings;
use App\Support\Http\ApiException;
use Illuminate\Filesystem\Filesystem;

final class StreamSlots
{
    /** @return resource */
    public function acquire()
    {
        $instance = gethostname();
        if ($instance === false || $instance === '') {
            throw new ApiException(503, 'SSE instance identity unavailable');
        }
        $directory = storage_path('framework/sse/'.hash('sha256', $instance));
        if (! is_dir($directory)) {
            (new Filesystem)->makeDirectory($directory, 0700, true, true);
        }
        if (! is_dir($directory)) {
            throw new ApiException(503, 'SSE admission unavailable');
        }
        for ($slot = 0; $slot < Settings::integer('backend.sse.connections', 1, 1024); $slot++) {
            $handle = fopen($directory.'/'.$slot.'.lock', 'c');
            if ($handle === false) {
                continue;
            }
            if (flock($handle, LOCK_EX | LOCK_NB)) {
                return $handle;
            }
            fclose($handle);
        }
        throw new ApiException(503, 'SSE connection budget exhausted');
    }
}
