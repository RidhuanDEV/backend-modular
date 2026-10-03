<?php

declare(strict_types=1);

namespace App\Modules\Auth\Services;

use App\Modules\Users\Models\User;
use App\Support\Http\ApiException;

final class Actor
{
    public function user(): User
    {
        $user = auth()->user();
        if (! $user instanceof User) {
            throw new ApiException(401, 'Authentication required');
        }

        return $user;
    }
}
