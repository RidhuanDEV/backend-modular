<?php

declare(strict_types=1);

namespace App\Modules\Uploads\Http;

use App\Modules\Auth\Services\Actor;
use App\Modules\Uploads\Http\Requests\DownloadRequest;
use App\Modules\Uploads\Http\Requests\UploadRequest;
use App\Modules\Uploads\Http\Resources\StoredFileResource;
use App\Modules\Uploads\Services\UploadService;
use App\Support\Http\Api;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class UploadController
{
    public function __construct(private readonly UploadService $service, private readonly Actor $actor) {}

    public function create(UploadRequest $request): JsonResponse
    {
        return Api::resource(new StoredFileResource($this->service->create($request->upload(), $this->actor->user())), 201);
    }

    public function get(DownloadRequest $request, string $id): JsonResponse|StreamedResponse
    {
        $file = $this->service->get($id);
        if (! $request->download()) {
            return Api::resource(new StoredFileResource($file));
        }

        return Storage::disk($file->storage)->download($file->object_key, $file->original_name, ['Content-Type' => $file->mime_type, 'X-Content-Type-Options' => 'nosniff']);
    }
}
