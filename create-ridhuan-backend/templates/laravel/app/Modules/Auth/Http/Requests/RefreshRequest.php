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
        // Optional so cookie mode can read the httpOnly cookie instead; the controller enforces presence.
        return ['refreshToken' => ['sometimes', 'string', 'min:1', 'max:512']];
    }

    public function token(): ?string
    {
        return Input::optionalString($this->validated(), 'refreshToken');
    }
}
