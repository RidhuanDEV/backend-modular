<?php

declare(strict_types=1);

namespace App\Modules\Auth\Http\Requests;

use App\Support\Http\BackendRequest;
use App\Support\Http\Input;

final class RefreshRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['refreshToken' => ['required', 'string', 'min:1', 'max:512']];
    }

    public function token(): string
    {
        return Input::string($this->validated(), 'refreshToken');
    }
}
