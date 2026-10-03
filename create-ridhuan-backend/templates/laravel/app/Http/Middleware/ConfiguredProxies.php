<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Config\Settings;
use Closure;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use UnexpectedValueException;

final class ConfiguredProxies extends TrustProxies
{
    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $proxy = Settings::string('backend.proxy');
        $this->proxies =
            $proxy === '' ? [] : array_map(trim(...), explode(',', $proxy));
        $response = parent::handle($request, $next);
        if (!($response instanceof Response)) {
            throw new UnexpectedValueException(
                'HTTP middleware must return a response',
            );
        }

        return $response;
    }
}
