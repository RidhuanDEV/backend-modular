<?php

declare(strict_types=1);

namespace App\Support\Endpoint;

use App\Modules\Auth\Http\AuthController;
use App\Modules\Notifications\Http\NotificationController;
use App\Modules\Permissions\Http\PermissionController;
use App\Modules\Roles\Http\RoleController;
use App\Modules\System\Http\DocsController;
use App\Modules\System\Http\SystemController;
use App\Modules\Uploads\Http\UploadController;
use App\Modules\Users\Http\UserController;
use App\Support\Config\Settings;
use Illuminate\Support\Facades\Route;
use InvalidArgumentException;

final class EndpointRegistry
{
    /** @return list<EndpointDefinition> */
    public function all(): array
    {
        $definitions = [
            new EndpointDefinition(EndpointId::health_get, 'GET', '/health', 'health', SystemController::class, 'get', 200, false, null, 'none', 'read', 'public', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::live_get, 'GET', '/live', 'live', SystemController::class, 'get', 200, false, null, 'none', 'read', 'public', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::ready_get, 'GET', '/ready', 'ready', SystemController::class, 'get', 200, false, null, 'none', 'read', 'public', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::docs_spec, 'GET', '/docs/openapi.json', 'docs', DocsController::class, 'spec', 200, false, null, 'none', 'read', 'public', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::docs_moduleSpec, 'GET', '/docs/specs/{module}.json', 'docs', DocsController::class, 'moduleSpec', 200, false, null, 'none', 'read', 'public', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::docs_ui, 'GET', '/docs', 'docs', DocsController::class, 'ui', 200, false, null, 'none', 'read', 'public', 'off', 'text/html'),
            new EndpointDefinition(EndpointId::auth_register, 'POST', '/api/auth/register', 'auth', AuthController::class, 'register', 201, false, null, 'required', 'transaction', 'auth', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::auth_login, 'POST', '/api/auth/login', 'auth', AuthController::class, 'login', 200, false, null, 'optional', 'transaction', 'auth', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::auth_refresh, 'POST', '/api/auth/refresh', 'auth', AuthController::class, 'refresh', 200, false, null, 'required', 'transaction', 'auth', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::auth_logout, 'POST', '/api/auth/logout', 'auth', AuthController::class, 'logout', 204, false, null, 'required', 'transaction', 'auth', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::auth_me, 'GET', '/api/auth/me', 'auth', AuthController::class, 'me', 200, true, null, 'none', 'read', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::user_list, 'GET', '/api/users', 'user', UserController::class, 'list', 200, true, 'manage_users', 'none', 'read', 'internal', 'read', 'application/json'),
            new EndpointDefinition(EndpointId::user_get, 'GET', '/api/users/{id}', 'user', UserController::class, 'get', 200, true, 'manage_users', 'none', 'read', 'internal', 'read', 'application/json'),
            new EndpointDefinition(EndpointId::user_create, 'POST', '/api/users', 'user', UserController::class, 'create', 201, true, 'manage_users', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::user_update, 'PATCH', '/api/users/{id}', 'user', UserController::class, 'update', 200, true, 'manage_users', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::user_delete, 'DELETE', '/api/users/{id}', 'user', UserController::class, 'delete', 204, true, 'manage_users', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::role_list, 'GET', '/api/roles', 'role', RoleController::class, 'list', 200, true, 'manage_roles', 'none', 'read', 'internal', 'read', 'application/json'),
            new EndpointDefinition(EndpointId::role_get, 'GET', '/api/roles/{id}', 'role', RoleController::class, 'get', 200, true, 'manage_roles', 'none', 'read', 'internal', 'read', 'application/json'),
            new EndpointDefinition(EndpointId::role_create, 'POST', '/api/roles', 'role', RoleController::class, 'create', 201, true, 'manage_roles', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::role_update, 'PATCH', '/api/roles/{id}', 'role', RoleController::class, 'update', 200, true, 'manage_roles', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::role_delete, 'DELETE', '/api/roles/{id}', 'role', RoleController::class, 'delete', 204, true, 'manage_roles', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::role_assignPermissions, 'POST', '/api/roles/{id}/permissions', 'role', RoleController::class, 'assignPermissions', 200, true, 'manage_roles', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::permission_list, 'GET', '/api/permissions', 'permission', PermissionController::class, 'list', 200, true, 'manage_permissions', 'none', 'read', 'internal', 'read', 'application/json'),
            new EndpointDefinition(EndpointId::permission_get, 'GET', '/api/permissions/{id}', 'permission', PermissionController::class, 'get', 200, true, 'manage_permissions', 'none', 'read', 'internal', 'read', 'application/json'),
            new EndpointDefinition(EndpointId::permission_create, 'POST', '/api/permissions', 'permission', PermissionController::class, 'create', 201, true, 'manage_permissions', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::permission_update, 'PATCH', '/api/permissions/{id}', 'permission', PermissionController::class, 'update', 200, true, 'manage_permissions', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::permission_delete, 'DELETE', '/api/permissions/{id}', 'permission', PermissionController::class, 'delete', 204, true, 'manage_permissions', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::upload_create, 'POST', '/api/upload', 'upload', UploadController::class, 'create', 201, true, 'manage_uploads', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::upload_get, 'GET', '/api/upload/{id}', 'upload', UploadController::class, 'get', 200, true, 'manage_uploads', 'none', 'read', 'internal', 'read', 'application/json'),
            new EndpointDefinition(EndpointId::notification_create, 'POST', '/api/notifications', 'notification', NotificationController::class, 'create', 201, true, 'manage_notifications', 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::notification_list, 'GET', '/api/notifications', 'notification', NotificationController::class, 'list', 200, true, null, 'none', 'read', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::notification_read, 'PATCH', '/api/notifications/{id}/read', 'notification', NotificationController::class, 'read', 200, true, null, 'required', 'transaction', 'internal', 'off', 'application/json'),
            new EndpointDefinition(EndpointId::notification_stream, 'GET', '/api/notifications/stream', 'notification', NotificationController::class, 'stream', 200, true, null, 'none', 'read', 'internal', 'off', 'text/event-stream'),
        ];
        foreach (glob(app_path('Modules/*/endpoints.php')) ?: [] as $file) {
            $extra = require $file;
            if (! is_array($extra)) {
                throw new InvalidArgumentException('Invalid module registry');
            }
            foreach ($extra as $definition) {
                if (! $definition instanceof EndpointDefinition) {
                    throw new InvalidArgumentException('Invalid module definition');
                } $definitions[] = $definition;
            }
        }
        $overrides = json_decode(Settings::string('backend.policies'), true, flags: JSON_THROW_ON_ERROR);
        if (! is_array($overrides)) {
            throw new InvalidArgumentException('Invalid ENDPOINT_POLICIES_JSON');
        }
        $known = array_map(fn (EndpointDefinition $d): string => $d->id->value, $definitions);
        foreach ($overrides as $id => $values) {
            if (! in_array($id, $known, true) || ! is_array($values)) {
                throw new InvalidArgumentException('Unknown endpoint policy');
            }foreach ($values as $key => $value) {
                $allowed = match ($key) {
                    'audit' => ['required', 'optional', 'none'],'cache' => ['read', 'off'],'rateLimit' => ['auth', 'public', 'internal'],default => []
                };
                if (! is_string($value) || ! in_array($value, $allowed, true)) {
                    throw new InvalidArgumentException('Invalid endpoint override');
                }
            }
        }

        return array_map(function (EndpointDefinition $d) use ($overrides): EndpointDefinition {
            $v = $overrides[$d->id->value] ?? [];
            if (! is_array($v)) {
                throw new InvalidArgumentException('Invalid endpoint override');
            }
            $audit = $v['audit'] ?? $d->audit;
            $cache = $v['cache'] ?? $d->cache;
            $rate = $v['rateLimit'] ?? $d->rate;
            if (! is_string($audit) || ! is_string($cache) || ! is_string($rate)) {
                throw new InvalidArgumentException('Invalid policy value');
            }
            if (($audit === 'required' && $d->capability !== 'transaction') || ($audit === 'optional' && $d->capability === 'none') || ($cache === 'read' && ($d->method !== 'GET' || $d->action === 'stream'))) {
                throw new InvalidArgumentException('Endpoint capability violation');
            }

            return new EndpointDefinition($d->id, $d->method, $d->path, $d->module, $d->controller, $d->action, $d->status, $d->authenticated, $d->permission, $audit, $d->capability, $rate, $cache, $d->media);
        }, $definitions);
    }

    public function get(string $id): EndpointDefinition
    {
        foreach ($this->all() as $definition) {
            if ($definition->id->value === $id) {
                return $definition;
            }
        }throw new InvalidArgumentException('Unknown endpoint');
    }

    public function mount(): void
    {
        foreach ($this->all() as $d) {
            $route = Route::match([$d->method], $d->path, [$d->controller, $d->action])->name($d->id->value);
            if (str_contains($d->path, '{id}')) {
                $route->whereUuid('id');
            } if (str_contains($d->path, '{module}')) {
                $route->where('module', '[a-z]+');
            }
        }
    }

    public function verify(): void
    {
        $expected = [];
        foreach ($this->all() as $d) {
            $expected[$d->id->value] = $d;
        } foreach (Route::getRoutes()->getRoutes() as $r) {
            $name = $r->getName();
            if ($name === null || ! isset($expected[$name])) {
                throw new InvalidArgumentException('Unregistered HTTP route');
            }$d = $expected[$name];
            $methods = [];
            foreach ($r->methods() as $method) {
                if (! is_string($method)) {
                    throw new InvalidArgumentException('Invalid route method');
                }
                if ($method !== 'HEAD') {
                    $methods[] = $method;
                }
            }
            if ('/'.$r->uri() !== $d->path || $methods !== [$d->method]) {
                throw new InvalidArgumentException('Route contract mismatch');
            }unset($expected[$name]);
        }if ($expected !== []) {
            throw new InvalidArgumentException('Missing route');
        }
    }
}
