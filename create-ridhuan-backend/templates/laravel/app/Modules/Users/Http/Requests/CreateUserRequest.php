<?php

declare(strict_types=1);

namespace App\Modules\Users\Http\Requests;

use App\Modules\Users\Data\CreateUser;
use App\Support\Http\BackendRequest;
use App\Support\Http\Input;

final class CreateUserRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['email' => ['required', 'string', 'email', 'max:255'], 'password' => ['required', 'string', 'min:6'], 'roleId' => ['required', 'uuid']];
    }

    public function dto(): CreateUser
    {
        $v = $this->validated();

        return new CreateUser(Input::string($v, 'email'), Input::string($v, 'password'), Input::string($v, 'roleId'));
    }
}
