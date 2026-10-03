<?php

declare(strict_types=1);

namespace App\Support\Http;

use Illuminate\Validation\ValidationException;

final class ErrorEnvelope
{
    /** @return array{success:false,message:string} */
    public static function make(string $message): array
    {
        return ['success' => false, 'message' => $message];
    }

    /**
     * @param  array<string,list<string>>  $errors
     * @return array{success:false,message:string,errors:array<string,list<string>>}
     */
    public static function validationResponse(string $message, array $errors): array
    {
        return ['success' => false, 'message' => $message, 'errors' => $errors];
    }

    /** @return array<string,list<string>> */
    public static function validation(ValidationException $exception): array
    {
        $result = [];
        foreach ($exception->errors() as $field => $messages) {
            if (! is_string($field) || ! is_array($messages)) {
                throw new \LogicException('Invalid validation boundary');
            }
            $items = [];
            foreach ($messages as $message) {
                if (! is_string($message)) {
                    throw new \LogicException('Invalid validation message');
                }
                $items[] = $message;
            }
            $result[$field] = $items;
        }

        return $result;
    }
}
