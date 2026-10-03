<?php

declare(strict_types=1);

namespace App\Modules\Permissions\Http\Requests;

use App\Support\Http\BackendRequest;
use App\Support\Http\Input;

final class CreateNameRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['name' => ['required', 'string', 'min:1', 'max:128']];
    }

    public function nameValue(): ?string
    {
        return Input::optionalString($this->validated(), 'name');
    }
}
