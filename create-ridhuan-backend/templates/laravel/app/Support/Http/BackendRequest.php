<?php

declare(strict_types=1);

namespace App\Support\Http;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

abstract class BackendRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $email = $this->input('email');
        if (is_string($email)) {
            $this->merge(['email' => mb_strtolower(trim($email))]);
        }
    }

    protected function passedValidation(): void
    {
        $password = $this->input('password');
        if (is_string($password) && strlen($password) > 72) {
            throw ValidationException::withMessages([
                'password' => 'Maximum 72 UTF-8 bytes',
            ]);
        }
    }
}
