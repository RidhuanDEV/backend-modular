<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Data;

enum EmailStatus: string
{
    case NotRequested = 'NOT_REQUESTED';
    case Pending = 'PENDING';
    case Sent = 'SENT';
    case Failed = 'FAILED';
}
