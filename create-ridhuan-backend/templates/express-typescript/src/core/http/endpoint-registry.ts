import { z, type ZodType } from "zod";
import { env } from "../../config/env.js";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
} from "../../modules/auth/auth.schema.js";
import {
  createUserSchema,
  updateUserSchema,
  userIdSchema,
  searchUserSchema,
} from "../../modules/user/user.schema.js";
import {
  createRoleSchema,
  updateRoleSchema,
  roleIdSchema,
  assignPermissionsSchema,
} from "../../modules/roles/role.schema.js";
import {
  createPermissionSchema,
  updatePermissionSchema,
  permissionIdSchema,
} from "../../modules/permissions/permission.schema.js";
import type { RateLimitGroup } from "../middleware/rate-limit.middleware.js";
import type { PermissionName } from "../../constants/permissions.constants.js";

export type AuditMode = "required" | "optional" | "none";
export type CacheMode = "read" | "off";
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type Access =
  | { kind: "public" }
  | { kind: "internal"; permission?: PermissionName };

export interface EndpointDefinition {
  method: HttpMethod;
  path: string;
  module: string;
  summary: string;
  access: Access;
  audit: AuditMode;
  rateLimit: RateLimitGroup;
  cache: CacheMode;
  status: number;
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
  response?: ZodType;
  multipart?: boolean;
  contentType?: "text/html";
}

const isoDate = z.iso.datetime({ offset: true });
const permission = z.object({ id: z.string(), name: z.string() });
const baseRole = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
const role = baseRole.extend({
  permissions: z.array(z.object({ permission })),
});
const user = z.object({
  id: z.string(),
  email: z.email(),
  roleId: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
  role: z
    .object({
      id: z.string(),
      name: z.string(),
      permissions: z.array(permission),
    })
    .optional(),
});
const dbPermission = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
const safeAuthUser = z.object({
  id: z.string(),
  email: z.email(),
  roleId: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
const authTokens = z.object({ token: z.string(), refreshToken: z.string() });
const file = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  createdAt: isoDate,
});
const pagination = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});
const success = (data: ZodType) =>
  z.object({ success: z.literal(true), data, meta: pagination.optional() });
const noContent = z.undefined();
const notification = z.object({ id: z.uuid(), recipientId: z.uuid(), title: z.string(), body: z.string(),
  emailStatus: z.enum(["NOT_REQUESTED", "PENDING", "SENT", "FAILED"]),
  readAt: isoDate.nullable(), createdAt: isoDate });
const notificationId = z.object({ id: z.uuid() });
const createNotification = z.object({ recipientId: z.uuid(), title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000), sendEmail: z.boolean().default(false) });
export { createNotification };

export const endpointRegistry = {
  "health.get": {
    method: "GET",
    path: "/health",
    module: "system",
    summary: "Health check",
    access: { kind: "public" },
    audit: "none",
    rateLimit: "public",
    cache: "off",
    status: 200,
    response: success(z.object({ status: z.literal("ok") })),
  },
  "live.get": {
    method: "GET",
    path: "/live",
    module: "system",
    summary: "Process liveness",
    access: { kind: "public" },
    audit: "none",
    rateLimit: "public",
    cache: "off",
    status: 200,
    response: success(z.object({ status: z.literal("ok") })),
  },
  "ready.get": {
    method: "GET",
    path: "/ready",
    module: "system",
    summary: "Required dependency readiness",
    access: { kind: "public" },
    audit: "none",
    rateLimit: "public",
    cache: "off",
    status: 200,
    response: success(z.object({ status: z.literal("ok") })),
  },
  "docs.spec": {
    method: "GET",
    path: "/docs/openapi.json",
    module: "docs",
    summary: "OpenAPI specification",
    access: { kind: "public" },
    audit: "none",
    rateLimit: "public",
    cache: "off",
    status: 200,
  },
  "docs.moduleSpec": {
    method: "GET",
    path: "/docs/specs/:module.json",
    module: "docs",
    summary: "Module OpenAPI specification",
    access: { kind: "public" },
    audit: "none",
    rateLimit: "public",
    cache: "off",
    status: 200,
    params: z.object({ module: z.string().min(1) }),
  },
  "docs.ui": {
    method: "GET",
    path: "/docs",
    module: "docs",
    summary: "API documentation UI",
    access: { kind: "public" },
    audit: "none",
    rateLimit: "public",
    cache: "off",
    status: 200,
    contentType: "text/html",
  },
  "auth.register": {
    method: "POST",
    path: "/api/auth/register",
    module: "auth",
    summary: "Register account",
    access: { kind: "public" },
    audit: "required",
    rateLimit: "auth",
    cache: "off",
    status: 201,
    body: registerSchema,
    response: success(safeAuthUser),
  },
  "auth.login": {
    method: "POST",
    path: "/api/auth/login",
    module: "auth",
    summary: "Login",
    access: { kind: "public" },
    audit: "optional",
    rateLimit: "auth",
    cache: "off",
    status: 200,
    body: loginSchema,
    response: success(authTokens),
  },
  "auth.refresh": {
    method: "POST",
    path: "/api/auth/refresh",
    module: "auth",
    summary: "Rotate refresh token and issue a new access token",
    access: { kind: "public" },
    audit: "none",
    rateLimit: "auth",
    cache: "off",
    status: 200,
    body: refreshSchema,
    response: success(authTokens),
  },
  "auth.logout": {
    method: "POST",
    path: "/api/auth/logout",
    module: "auth",
    summary: "Revoke refresh token",
    access: { kind: "public" },
    audit: "none",
    rateLimit: "auth",
    cache: "off",
    status: 204,
    body: logoutSchema,
  },
  "auth.me": {
    method: "GET",
    path: "/api/auth/me",
    module: "auth",
    summary: "Current user",
    access: { kind: "internal" },
    audit: "none",
    rateLimit: "internal",
    cache: "off",
    status: 200,
    response: success(safeAuthUser),
  },
  "user.list": {
    method: "GET",
    path: "/api/users",
    module: "user",
    summary: "List users",
    access: { kind: "internal", permission: "manage_users" },
    audit: "none",
    rateLimit: "internal",
    cache: "read",
    status: 200,
    query: searchUserSchema,
    response: success(z.array(user)),
  },
  "user.get": {
    method: "GET",
    path: "/api/users/:id",
    module: "user",
    summary: "Get user",
    access: { kind: "internal", permission: "manage_users" },
    audit: "none",
    rateLimit: "internal",
    cache: "read",
    status: 200,
    params: userIdSchema,
    response: success(user),
  },
  "user.create": {
    method: "POST",
    path: "/api/users",
    module: "user",
    summary: "Create user",
    access: { kind: "internal", permission: "manage_users" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 201,
    body: createUserSchema,
    response: success(user),
  },
  "user.update": {
    method: "PATCH",
    path: "/api/users/:id",
    module: "user",
    summary: "Update user",
    access: { kind: "internal", permission: "manage_users" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 200,
    params: userIdSchema,
    body: updateUserSchema,
    response: success(user),
  },
  "user.delete": {
    method: "DELETE",
    path: "/api/users/:id",
    module: "user",
    summary: "Delete user",
    access: { kind: "internal", permission: "manage_users" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 204,
    params: userIdSchema,
    response: noContent,
  },
  "role.list": {
    method: "GET",
    path: "/api/roles",
    module: "roles",
    summary: "List roles",
    access: { kind: "internal", permission: "manage_roles" },
    audit: "none",
    rateLimit: "internal",
    cache: "read",
    status: 200,
    response: success(z.array(role)),
  },
  "role.get": {
    method: "GET",
    path: "/api/roles/:id",
    module: "roles",
    summary: "Get role",
    access: { kind: "internal", permission: "manage_roles" },
    audit: "none",
    rateLimit: "internal",
    cache: "read",
    status: 200,
    params: roleIdSchema,
    response: success(role),
  },
  "role.create": {
    method: "POST",
    path: "/api/roles",
    module: "roles",
    summary: "Create role",
    access: { kind: "internal", permission: "manage_roles" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 201,
    body: createRoleSchema,
    response: success(baseRole),
  },
  "role.update": {
    method: "PATCH",
    path: "/api/roles/:id",
    module: "roles",
    summary: "Update role",
    access: { kind: "internal", permission: "manage_roles" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 200,
    params: roleIdSchema,
    body: updateRoleSchema,
    response: success(baseRole),
  },
  "role.delete": {
    method: "DELETE",
    path: "/api/roles/:id",
    module: "roles",
    summary: "Delete role",
    access: { kind: "internal", permission: "manage_roles" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 204,
    params: roleIdSchema,
    response: noContent,
  },
  "role.assignPermissions": {
    method: "POST",
    path: "/api/roles/:id/permissions",
    module: "roles",
    summary: "Assign permissions",
    access: { kind: "internal", permission: "manage_roles" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 200,
    params: roleIdSchema,
    body: assignPermissionsSchema,
    response: success(role),
  },
  "permission.list": {
    method: "GET",
    path: "/api/permissions",
    module: "permissions",
    summary: "List permissions",
    access: { kind: "internal", permission: "manage_permissions" },
    audit: "none",
    rateLimit: "internal",
    cache: "read",
    status: 200,
    response: success(z.array(dbPermission)),
  },
  "permission.get": {
    method: "GET",
    path: "/api/permissions/:id",
    module: "permissions",
    summary: "Get permission",
    access: { kind: "internal", permission: "manage_permissions" },
    audit: "none",
    rateLimit: "internal",
    cache: "read",
    status: 200,
    params: permissionIdSchema,
    response: success(dbPermission),
  },
  "permission.create": {
    method: "POST",
    path: "/api/permissions",
    module: "permissions",
    summary: "Create permission",
    access: { kind: "internal", permission: "manage_permissions" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 201,
    body: createPermissionSchema,
    response: success(dbPermission),
  },
  "permission.update": {
    method: "PATCH",
    path: "/api/permissions/:id",
    module: "permissions",
    summary: "Update permission",
    access: { kind: "internal", permission: "manage_permissions" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 200,
    params: permissionIdSchema,
    body: updatePermissionSchema,
    response: success(dbPermission),
  },
  "permission.delete": {
    method: "DELETE",
    path: "/api/permissions/:id",
    module: "permissions",
    summary: "Delete permission",
    access: { kind: "internal", permission: "manage_permissions" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 204,
    params: permissionIdSchema,
    response: noContent,
  },
  "upload.create": {
    method: "POST",
    path: "/api/upload",
    module: "upload",
    summary: "Upload file",
    access: { kind: "internal", permission: "manage_uploads" },
    audit: "required",
    rateLimit: "internal",
    cache: "off",
    status: 201,
    multipart: true,
    response: success(file),
  },
  "upload.get": {
    method: "GET",
    path: "/api/upload/:id",
    module: "upload",
    summary: "Get file metadata",
    access: { kind: "internal", permission: "manage_uploads" },
    audit: "none",
    rateLimit: "internal",
    cache: "read",
    status: 200,
    params: z.object({ id: z.uuid() }),
    response: success(file),
  },
  "notification.create": { method: "POST", path: "/api/notifications", module: "notifications",
    summary: "Create notification", access: { kind: "internal", permission: "manage_notifications" },
    audit: "required", rateLimit: "internal", cache: "off", status: 201,
    body: createNotification, response: success(notification) },
  "notification.list": { method: "GET", path: "/api/notifications", module: "notifications",
    summary: "List own notifications", access: { kind: "internal" },
    audit: "none", rateLimit: "internal", cache: "off", status: 200,
    response: success(z.array(notification)) },
  "notification.read": { method: "PATCH", path: "/api/notifications/:id/read", module: "notifications",
    summary: "Mark own notification read", access: { kind: "internal" },
    audit: "required", rateLimit: "internal", cache: "off", status: 200,
    params: notificationId, response: success(notification) },
  "notification.stream": { method: "GET", path: "/api/notifications/stream", module: "notifications",
    summary: "Stream own notifications", access: { kind: "internal" },
    audit: "none", rateLimit: "internal", cache: "off", status: 200 },
} as const satisfies Record<string, EndpointDefinition>;

export type EndpointId = keyof typeof endpointRegistry;
const overrideSchema = z.record(
  z.string(),
  z.object({
    audit: z.enum(["required", "optional", "none"]).optional(),
    rateLimit: z.enum(["auth", "public", "internal"]).optional(),
    cache: z.enum(["read", "off"]).optional(),
  }),
);
const overrides = overrideSchema.parse(
  JSON.parse(env.ENDPOINT_POLICIES_JSON) as unknown,
);
for (const id of Object.keys(overrides)) {
  if (!(id in endpointRegistry))
    throw new Error(`Unknown endpoint policy override: ${id}`);
}

export function endpointPolicy(id: EndpointId): EndpointDefinition {
  const base: EndpointDefinition = endpointRegistry[id];
  const override = overrides[id];
  if (
    override?.audit === "required" &&
    base.audit === "none" &&
    base.method === "GET"
  )
    throw new Error(
      `Read-only endpoint ${id} needs an audit producer before required mode`,
    );
  return {
    ...base,
    ...(override?.audit ? { audit: override.audit } : {}),
    ...(override?.rateLimit ? { rateLimit: override.rateLimit } : {}),
    ...(override?.cache ? { cache: override.cache } : {}),
  };
}
