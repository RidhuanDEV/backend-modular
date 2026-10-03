<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Data;

final readonly class CreateNotification
{
    public function __construct(public string $recipientId, public string $title, public string $body, public bool $sendEmail) {}
}
