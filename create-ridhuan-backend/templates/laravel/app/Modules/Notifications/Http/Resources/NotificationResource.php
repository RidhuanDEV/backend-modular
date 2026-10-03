<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Http\Resources;

use App\Modules\Notifications\Models\Notification;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property Notification $resource */
final class NotificationResource extends JsonResource
{
    public function __construct(private readonly Notification $model)
    {
        parent::__construct($model);
    }

    /** @return array{id:string,recipientId:string,title:string,body:string,emailStatus:'NOT_REQUESTED'|'PENDING'|'SENT'|'FAILED',readAt:string|null,createdAt:string} */
    public function toArray(Request $request): array
    {
        $m = $this->model;

        return ['id' => $m->id, 'recipientId' => $m->recipient_id, 'title' => $m->title, 'body' => $m->body, 'emailStatus' => $m->email_status->value, 'readAt' => $m->read_at?->toIso8601ZuluString('microsecond'), 'createdAt' => $m->created_at->toIso8601ZuluString('microsecond')];
    }
}
