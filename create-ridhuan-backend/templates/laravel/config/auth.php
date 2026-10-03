<?php

declare(strict_types=1);
use App\Modules\Users\Models\User;

return [
    'defaults' => ['guard' => 'api'],
    'guards' => ['api' => ['driver' => 'backend-jwt', 'provider' => 'users']],
    'providers' => [
        'users' => ['driver' => 'eloquent', 'model' => User::class],
    ],
];
