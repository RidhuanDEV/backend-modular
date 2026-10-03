<?php

declare(strict_types=1);

namespace App\Modules\Roles\Http\Requests;

use App\Support\Http\BackendRequest;
use App\Support\Http\Input;

final class AssignPermissionsRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['permissionIds' => ['required', 'array', 'min:1'], 'permissionIds.*' => ['required', 'uuid', 'distinct']];
    }

    /** @return list<string> */
    public function ids(): array
    {
        return Input::strings($this->validated(), 'permissionIds');
    }
}
