<?php

declare(strict_types=1);

namespace App\Modules\Uploads\Http\Requests;

use App\Support\Http\BackendRequest;

final class DownloadRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['download' => ['sometimes', 'in:true,false']];
    }

    public function download(): bool
    {
        return $this->validated('download', 'false') === 'true';
    }
}
