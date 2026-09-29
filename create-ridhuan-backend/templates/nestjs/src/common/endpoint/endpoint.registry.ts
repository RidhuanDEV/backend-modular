import { applyDecorators, Injectable, SetMetadata, type Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExtraModels, ApiOperation, ApiResponse, getSchemaPath } from "@nestjs/swagger";
import { AuthResponseDto, AuthUserResponseDto } from "../../modules/auth/dto/auth.dto";
import { PermissionResponseDto } from "../../modules/permissions/dto/permission.dto";
import { RoleResponseDto } from "../../modules/roles/dto/role.dto";
import { UploadResponseDto } from "../../modules/uploads/dto/upload.dto";
import { UserResponseDto } from "../../modules/users/dto/user.dto";
import { NotificationResponseDto } from "../../modules/notifications/dto/notification.dto";
import type { AppConfig } from "../../config/env.validation";

export type AuditMode = "required" | "optional" | "none";
export type CacheMode = "read" | "off";
export type RateGroup = "auth" | "public" | "internal";
export type PermissionName = "manage_users" | "manage_roles" | "manage_permissions" | "manage_uploads" | "manage_notifications";

export interface EndpointDefinition {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  module: string;
  summary: string;
  public: boolean;
  permission?: PermissionName;
  audit: AuditMode;
  cache: CacheMode;
  rateLimit: RateGroup;
  status: number;
}

const definition = (method: EndpointDefinition["method"], path: string, module: string,
  summary: string, isPublic: boolean, audit: AuditMode, cache: CacheMode,
  rateLimit: RateGroup, status: number, permission?: PermissionName): EndpointDefinition => ({
  method, path, module, summary, public: isPublic, audit, cache, rateLimit, status,
  ...(permission ? { permission } : {}),
});

export const endpointRegistry = {
  "health.get": definition("GET", "/health", "system", "Compatibility health", true, "none", "off", "public", 200),
  "live.get": definition("GET", "/live", "system", "Process liveness", true, "none", "off", "public", 200),
  "ready.get": definition("GET", "/ready", "system", "Dependency readiness", true, "none", "off", "public", 200),
  "docs.ui": definition("GET", "/docs", "docs", "API documentation", true, "none", "off", "public", 200),
  "docs.spec": definition("GET", "/docs/openapi.json", "docs", "Full OpenAPI specification", true, "none", "off", "public", 200),
  "docs.moduleSpec": definition("GET", "/docs/specs/{module}.json", "docs", "Module OpenAPI specification", true, "none", "off", "public", 200),
  "auth.register": definition("POST", "/api/auth/register", "auth", "Register account", true, "required", "off", "auth", 201),
  "auth.login": definition("POST", "/api/auth/login", "auth", "Login", true, "optional", "off", "auth", 200),
  "auth.refresh": definition("POST", "/api/auth/refresh", "auth", "Rotate refresh token", true, "none", "off", "auth", 200),
  "auth.logout": definition("POST", "/api/auth/logout", "auth", "Revoke refresh family", true, "none", "off", "auth", 204),
  "auth.me": definition("GET", "/api/auth/me", "auth", "Current user", false, "none", "off", "internal", 200),
  "user.list": definition("GET", "/api/users", "user", "List users", false, "none", "read", "internal", 200, "manage_users"),
  "user.get": definition("GET", "/api/users/{id}", "user", "Get user", false, "none", "read", "internal", 200, "manage_users"),
  "user.create": definition("POST", "/api/users", "user", "Create user", false, "required", "off", "internal", 201, "manage_users"),
  "user.update": definition("PATCH", "/api/users/{id}", "user", "Update user", false, "required", "off", "internal", 200, "manage_users"),
  "user.delete": definition("DELETE", "/api/users/{id}", "user", "Delete user", false, "required", "off", "internal", 204, "manage_users"),
  "role.list": definition("GET", "/api/roles", "roles", "List roles", false, "none", "read", "internal", 200, "manage_roles"),
  "role.get": definition("GET", "/api/roles/{id}", "roles", "Get role", false, "none", "read", "internal", 200, "manage_roles"),
  "role.create": definition("POST", "/api/roles", "roles", "Create role", false, "required", "off", "internal", 201, "manage_roles"),
  "role.update": definition("PATCH", "/api/roles/{id}", "roles", "Update role", false, "required", "off", "internal", 200, "manage_roles"),
  "role.delete": definition("DELETE", "/api/roles/{id}", "roles", "Delete role", false, "required", "off", "internal", 204, "manage_roles"),
  "role.assignPermissions": definition("POST", "/api/roles/{id}/permissions", "roles", "Assign permissions", false, "required", "off", "internal", 200, "manage_roles"),
  "permission.list": definition("GET", "/api/permissions", "permissions", "List permissions", false, "none", "read", "internal", 200, "manage_permissions"),
  "permission.get": definition("GET", "/api/permissions/{id}", "permissions", "Get permission", false, "none", "read", "internal", 200, "manage_permissions"),
  "permission.create": definition("POST", "/api/permissions", "permissions", "Create permission", false, "required", "off", "internal", 201, "manage_permissions"),
  "permission.update": definition("PATCH", "/api/permissions/{id}", "permissions", "Update permission", false, "required", "off", "internal", 200, "manage_permissions"),
  "permission.delete": definition("DELETE", "/api/permissions/{id}", "permissions", "Delete permission", false, "required", "off", "internal", 204, "manage_permissions"),
  "upload.create": definition("POST", "/api/upload", "upload", "Upload file", false, "required", "off", "internal", 201, "manage_uploads"),
  "upload.get": definition("GET", "/api/upload/{id}", "upload", "Get file metadata", false, "none", "read", "internal", 200, "manage_uploads"),
  "notification.create": definition("POST", "/api/notifications", "notifications", "Create notification", false, "required", "off", "internal", 201, "manage_notifications"),
  "notification.list": definition("GET", "/api/notifications", "notifications", "List own notifications", false, "none", "off", "internal", 200),
  "notification.read": definition("PATCH", "/api/notifications/{id}/read", "notifications", "Mark own notification read", false, "required", "off", "internal", 200),
  "notification.stream": definition("GET", "/api/notifications/stream", "notifications", "Stream own notifications", false, "none", "off", "internal", 200),
} as const satisfies Record<string, EndpointDefinition>;

export type EndpointId = keyof typeof endpointRegistry;
export const ENDPOINT_ID_METADATA = Symbol("endpoint-id");
const responseTypes: Partial<Record<EndpointId, { type: Type<unknown>; list?: true }>> = {
  "auth.register": { type: AuthUserResponseDto }, "auth.login": { type: AuthResponseDto },
  "auth.refresh": { type: AuthResponseDto }, "auth.me": { type: AuthUserResponseDto },
  "user.list": { type: UserResponseDto, list: true }, "user.get": { type: UserResponseDto },
  "user.create": { type: UserResponseDto }, "user.update": { type: UserResponseDto },
  "role.list": { type: RoleResponseDto, list: true }, "role.get": { type: RoleResponseDto },
  "role.create": { type: RoleResponseDto }, "role.update": { type: RoleResponseDto },
  "role.assignPermissions": { type: RoleResponseDto },
  "permission.list": { type: PermissionResponseDto, list: true }, "permission.get": { type: PermissionResponseDto },
  "permission.create": { type: PermissionResponseDto }, "permission.update": { type: PermissionResponseDto },
  "upload.create": { type: UploadResponseDto }, "upload.get": { type: UploadResponseDto },
  "notification.create": { type: NotificationResponseDto },
  "notification.list": { type: NotificationResponseDto, list: true },
  "notification.read": { type: NotificationResponseDto },
};
export const Endpoint = (id: EndpointId): MethodDecorator => {
  const response = responseTypes[id];
  return applyDecorators(
    SetMetadata(ENDPOINT_ID_METADATA, id),
    ApiOperation({ operationId: id, summary: endpointRegistry[id].summary }),
    ...(response ? [ApiExtraModels(response.type)] : []),
    ApiResponse({ status: endpointRegistry[id].status, description: endpointRegistry[id].summary,
      ...(response ? { schema: { type: "object", required: ["success", "data"], properties: {
        success: { type: "boolean", enum: [true] },
        data: response.list ? { type: "array", items: { $ref: getSchemaPath(response.type) } } : { $ref: getSchemaPath(response.type) },
        ...(response.list ? { meta: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" },
          totalItems: { type: "integer" }, totalPages: { type: "integer" }, hasNextPage: { type: "boolean" }, hasPrevPage: { type: "boolean" } } } } : {}),
      } } } : {}),
    }),
  );
};

type PolicyOverride = Partial<Pick<EndpointDefinition, "audit" | "cache" | "rateLimit">>;
const allowedProperties = new Set(["audit", "cache", "rateLimit"]);

function parseOverrides(raw: string): Map<EndpointId, PolicyOverride> {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ENDPOINT_POLICIES_JSON must be an object");
  const result = new Map<EndpointId, PolicyOverride>();
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.hasOwn(endpointRegistry, key)) throw new Error(`Unknown endpoint policy: ${key}`);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid endpoint policy: ${key}`);
    const override: PolicyOverride = {};
    for (const [property, item] of Object.entries(value)) {
      if (!allowedProperties.has(property)) throw new Error(`Unknown policy property: ${key}.${property}`);
      if (property === "audit") {
        if (item !== "required" && item !== "optional" && item !== "none") throw new Error(`Invalid audit policy: ${key}`);
        override.audit = item;
      }
      if (property === "cache") {
        if (item !== "read" && item !== "off") throw new Error(`Invalid cache policy: ${key}`);
        override.cache = item;
      }
      if (property === "rateLimit") {
        if (item !== "auth" && item !== "public" && item !== "internal") throw new Error(`Invalid rate policy: ${key}`);
        override.rateLimit = item;
      }
    }
    result.set(key as EndpointId, override);
  }
  return result;
}

@Injectable()
export class EndpointPolicyService {
  private readonly policies: ReadonlyMap<EndpointId, EndpointDefinition>;

  constructor(config: ConfigService<AppConfig, true>) {
    const overrides = parseOverrides(config.get("ENDPOINT_POLICIES_JSON", { infer: true }));
    const entries = Object.entries(endpointRegistry).map(([key, base]) => {
      const id = key as EndpointId;
      const policy = { ...base, ...overrides.get(id) } as EndpointDefinition;
      if (policy.cache === "read" && policy.method !== "GET") throw new Error(`Cache is only valid for GET: ${id}`);
      if (policy.audit === "required" && policy.method === "GET") throw new Error(`Required GET audit producer missing: ${id}`);
      return [id, policy] as const;
    });
    this.policies = new Map(entries);
  }

  for(id: EndpointId): EndpointDefinition {
    const policy = this.policies.get(id);
    if (!policy) throw new Error(`Endpoint is not registered: ${id}`);
    return policy;
  }

  all(): ReadonlyMap<EndpointId, EndpointDefinition> { return this.policies; }
}
