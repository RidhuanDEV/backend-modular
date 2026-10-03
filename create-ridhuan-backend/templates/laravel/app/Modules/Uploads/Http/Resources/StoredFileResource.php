<?php

declare(strict_types=1);

namespace App\Modules\Uploads\Http\Resources;

use App\Modules\Uploads\Models\StoredFile;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property StoredFile $resource */
final class StoredFileResource extends JsonResource
{
    public function __construct(private readonly StoredFile $model)
    {
        parent::__construct($model);
    }

    /** @return array{id:string,originalName:string,mimeType:string,size:int,createdAt:string} */
    public function toArray(Request $request): array
    {
        $m = $this->model;

        return [
            'id' => $m->id,
            'originalName' => $m->original_name,
            'mimeType' => $m->mime_type,
            'size' => $m->size,
            'createdAt' => $m->created_at->toIso8601ZuluString('microsecond'),
        ];
    }
}
