<?php

declare(strict_types=1);

namespace App\Infrastructure\Storage;

use Illuminate\Http\UploadedFile;

interface ObjectStorage
{
    public function put(string $disk, string $key, UploadedFile $file): void;

    public function delete(string $disk, string $key): void;
}
