<?php

declare(strict_types=1);

namespace App\Modules\Uploads\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $storage
 * @property string $status
 * @property string $object_key
 * @property string $original_name
 * @property string $mime_type
 * @property int $size
 * @property ?string $uploader_id
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class StoredFile extends Model
{
    use HasUuids;

    protected $table = 'stored_files';

    protected $guarded = [];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime', 'size' => 'integer'];
    }
}
