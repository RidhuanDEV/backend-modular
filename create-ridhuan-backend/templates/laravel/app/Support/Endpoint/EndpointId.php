<?php

declare(strict_types=1);

namespace App\Support\Endpoint;

enum EndpointId: string
{
    case health_get = 'health.get';
    case live_get = 'live.get';
    case ready_get = 'ready.get';
    case docs_spec = 'docs.spec';
    case docs_moduleSpec = 'docs.moduleSpec';
    case docs_ui = 'docs.ui';
    case auth_register = 'auth.register';
    case auth_login = 'auth.login';
    case auth_refresh = 'auth.refresh';
    case auth_logout = 'auth.logout';
    case auth_me = 'auth.me';
    case user_list = 'user.list';
    case user_get = 'user.get';
    case user_create = 'user.create';
    case user_update = 'user.update';
    case user_delete = 'user.delete';
    case role_list = 'role.list';
    case role_get = 'role.get';
    case role_create = 'role.create';
    case role_update = 'role.update';
    case role_delete = 'role.delete';
    case role_assignPermissions = 'role.assignPermissions';
    case permission_list = 'permission.list';
    case permission_get = 'permission.get';
    case permission_create = 'permission.create';
    case permission_update = 'permission.update';
    case permission_delete = 'permission.delete';
    case upload_create = 'upload.create';
    case upload_get = 'upload.get';
    case notification_create = 'notification.create';
    case notification_list = 'notification.list';
    case notification_read = 'notification.read';
    case notification_stream = 'notification.stream';
}
