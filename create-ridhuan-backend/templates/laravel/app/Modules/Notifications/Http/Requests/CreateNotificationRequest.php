<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Http\Requests;

use App\Modules\Notifications\Data\CreateNotification;
use App\Support\Http\BackendRequest;
use App\Support\Http\Input;

final class CreateNotificationRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return ['recipientId' => ['required', 'uuid'], 'title' => ['required', 'string', 'max:160'], 'body' => ['required', 'string', 'max:4000'], 'sendEmail' => ['sometimes', 'boolean']];
    }

    public function dto(): CreateNotification
    {
        $v = $this->validated();

        return new CreateNotification(Input::string($v, 'recipientId'), trim(Input::string($v, 'title')), trim(Input::string($v, 'body')), Input::boolean($v, 'sendEmail'));
    }
}
