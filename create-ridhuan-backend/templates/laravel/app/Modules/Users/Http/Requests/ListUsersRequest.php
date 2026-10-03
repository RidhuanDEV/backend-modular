<?php

declare(strict_types=1);

namespace App\Modules\Users\Http\Requests;

use App\Modules\Users\Data\UserQuery;
use App\Support\Http\BackendRequest;
use App\Support\Http\Input;

final class ListUsersRequest extends BackendRequest
{
    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'page' => ['sometimes', 'integer', 'min:1'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'search' => ['sometimes', 'string', 'max:255'],
            'sortBy' => ['sometimes', 'in:email,createdAt,updatedAt'],
            'orderBy' => ['sometimes', 'in:asc,desc'],
            'fields' => ['sometimes', 'string', 'max:255'],
        ];
    }

    public function dto(): UserQuery
    {
        $v = $this->validated();
        $page = filter_var($v['page'] ?? 1, FILTER_VALIDATE_INT);
        $limit = filter_var($v['limit'] ?? 10, FILTER_VALIDATE_INT);
        if (!is_int($page) || !is_int($limit)) {
            throw new \LogicException('Validated pagination');
        }

        return new UserQuery(
            $page,
            $limit,
            Input::optionalString($v, 'search'),
            Input::optionalString($v, 'sortBy') ?? 'createdAt',
            Input::optionalString($v, 'orderBy') ?? 'desc',
            Input::optionalString($v, 'fields'),
        );
    }
}
