<?php

declare(strict_types=1);

namespace App\Modules\Users\Http\Requests;

use App\Modules\Users\Data\UpdateUser;
use App\Support\Http\BackendRequest;
use App\Support\Http\Input;

final class UpdateUserRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['email' => ['sometimes', 'string', 'email', 'max:255'], 'roleId' => ['sometimes', 'uuid']];
    }

    public function dto(): UpdateUser
    {
        $v = $this->validated();

        return new UpdateUser(Input::optionalString($v, 'email'), Input::optionalString($v, 'roleId'));
    }
}
