<?php

declare(strict_types=1);

namespace App\Support\Http;

use Illuminate\Validation\ValidationException;

final class Input
{
    /** @param array<array-key, mixed> $data */
    public static function string(array $data, string $key): string
    {
        $value = $data[$key] ?? null;
        if (!is_string($value)) {
            throw ValidationException::withMessages([
                $key => 'Expected string',
            ]);
        }

        return $value;
    }

    /** @param array<array-key, mixed> $data */
    public static function optionalString(array $data, string $key): ?string
    {
        return array_key_exists($key, $data) ? self::string($data, $key) : null;
    }

    /** @param array<array-key, mixed> $data */
    public static function boolean(
        array $data,
        string $key,
        bool $default = false,
    ): bool {
        $value = $data[$key] ?? $default;
        if (!is_bool($value)) {
            throw ValidationException::withMessages([
                $key => 'Expected boolean',
            ]);
        }

        return $value;
    }

    /**
     * @param  array<array-key, mixed>  $data
     * @return list<string>
     */
    public static function strings(array $data, string $key): array
    {
        $value = $data[$key] ?? null;
        if (!is_array($value) || !array_is_list($value)) {
            throw ValidationException::withMessages([$key => 'Expected list']);
        }
        $result = [];
        foreach ($value as $item) {
            if (!is_string($item)) {
                throw ValidationException::withMessages([
                    $key => 'Expected string list',
                ]);
            }
            $result[] = $item;
        }

        return $result;
    }
}
