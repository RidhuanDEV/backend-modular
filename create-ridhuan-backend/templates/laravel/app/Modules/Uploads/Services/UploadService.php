<?php

declare(strict_types=1);

namespace App\Modules\Uploads\Services;

use App\Infrastructure\Storage\ObjectStorage;
use App\Modules\Uploads\Models\StoredFile;
use App\Modules\Users\Models\User;
use App\Support\Audit\Audit;
use App\Support\Config\Settings;
use App\Support\Http\ApiException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

final class UploadService
{
    public function __construct(private readonly ObjectStorage $storage, private readonly Audit $audit) {}

    public function get(string $id): StoredFile
    {
        return StoredFile::query()->whereKey($id)->where('status', 'READY')->first() ?? throw new ApiException(404, 'File not found');
    }

    public function create(UploadedFile $file, User $actor): StoredFile
    {
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($file->getRealPath());
        $extension = match ($mime) {
            'image/png' => 'png', 'image/jpeg' => 'jpg', 'application/pdf' => 'pdf', default => throw new ApiException(422, 'Unsupported file signature')
        };
        if (! in_array($mime, explode(',', Settings::string('backend.upload.mime')), true) || $file->getSize() > Settings::integer('backend.upload.max', 1)) {
            throw new ApiException(422, 'Invalid upload');
        }
        $disk = Settings::string('backend.upload.disk');
        if (! in_array($disk, ['local', 's3'], true)) {
            throw new ApiException(503, 'Invalid upload adapter');
        }
        $key = Str::uuid()->toString().'.'.$extension;
        $this->storage->put($disk, $key, $file);
        try {
            return DB::transaction(function () use ($disk, $key, $file, $mime, $actor): StoredFile {
                $name = mb_substr(str_replace(["\r", "\n", "\0"], '', basename(str_replace('\\', '/', $file->getClientOriginalName()))), 0, 255);
                $record = StoredFile::query()->create(['storage' => $disk, 'object_key' => $key, 'original_name' => $name, 'mime_type' => $mime, 'size' => $file->getSize(), 'uploader_id' => $actor->id]);
                $this->audit->write('CREATE', 'upload', $record->id, $actor->id, after: ['id' => $record->id, 'mimeType' => $mime, 'size' => $record->size]);

                return $record;
            });
        } catch (Throwable $error) {
            try {
                $this->storage->delete($disk, $key);
            } catch (Throwable $compensation) {
                Log::warning('upload_compensation_failed', ['type' => $compensation::class]);
            }
            throw $error;
        }
    }
}
