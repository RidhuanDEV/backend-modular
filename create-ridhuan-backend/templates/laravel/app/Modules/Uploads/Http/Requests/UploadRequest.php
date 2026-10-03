<?php

declare(strict_types=1);

namespace App\Modules\Uploads\Http\Requests;

use App\Support\Config\Settings;
use App\Support\Http\BackendRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;

final class UploadRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'file' => [
                'required',
                'file',
                'max:' .
                (int) ceil(Settings::integer('backend.upload.max', 1) / 1024),
                'mimetypes:' . Settings::string('backend.upload.mime'),
            ],
        ];
    }

    public function upload(): UploadedFile
    {
        $file = $this->file('file');
        if (!($file instanceof UploadedFile)) {
            throw ValidationException::withMessages([
                'file' => 'Required file',
            ]);
        }

        return $file;
    }
}
