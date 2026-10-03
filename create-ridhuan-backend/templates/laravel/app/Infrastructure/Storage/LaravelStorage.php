<?php

declare(strict_types=1);

namespace App\Infrastructure\Storage;

use App\Support\Config\Settings;
use App\Support\Observability\Telemetry;
use Illuminate\Filesystem\AwsS3V3Adapter;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

final class LaravelStorage implements ObjectStorage
{
    public function put(string $disk, string $key, UploadedFile $file): void
    {
        $started = microtime(true);
        $stream = fopen($file->getRealPath(), 'rb');
        if ($stream === false) {
            throw new \RuntimeException('Upload stream unavailable');
        }
        try {
            $adapter = Storage::disk($disk);
            if ($disk === 's3') {
                if (! $adapter instanceof AwsS3V3Adapter) {
                    throw new \RuntimeException('Native S3 adapter required');
                }
                $adapter->getClient()->headBucket(['Bucket' => Settings::string('filesystems.disks.s3.bucket')]);
            }
            if (! $adapter->put($key, $stream, ['visibility' => 'private'])) {
                throw new \RuntimeException('Object write failed');
            }
        } finally {
            fclose($stream);
            app(Telemetry::class)->measure('storage.put', microtime(true) - $started);
        }
    }

    public function delete(string $disk, string $key): void
    {
        if (! Storage::disk($disk)->delete($key)) {
            throw new \RuntimeException('Object deletion failed');
        }
    }
}
