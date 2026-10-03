<?php

declare(strict_types=1);

namespace App\Modules\Auth\Http\Requests;

use App\Modules\Auth\Data\Credentials;
use App\Support\Http\BackendRequest;
use App\Support\Http\Input;

final class LoginRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['email' => ['required', 'string', 'email', 'max:255'], 'password' => ['required', 'string', 'min:1']];
    }

    public function dto(): Credentials
    {
        $v = $this->validated();

        return new Credentials(Input::string($v, 'email'), Input::string($v, 'password'));
    }
}
