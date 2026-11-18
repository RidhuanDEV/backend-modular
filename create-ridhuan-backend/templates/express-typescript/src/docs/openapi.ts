import { z, type ZodType } from "zod";
import {
  endpointRegistry,
  endpointPolicy,
  type EndpointId,
} from "../core/http/endpoint-registry.js";
import { env } from "../config/env.js";

type JsonObject = Record<string, unknown>;
// Requests are documented as clients send them ("input": defaulted fields are
// optional), responses as the server emits them ("output").
function jsonSchema(
  schema: ZodType,
  io: "input" | "output" = "output",
): JsonObject {
  const converted: JsonObject = z.toJSONSchema(schema, {
    unrepresentable: "any",
    io,
  });
  delete converted["$schema"];
  return converted;
}
function parameters(
  schema: ZodType | undefined,
  location: "path" | "query",
): JsonObject[] {
  if (!schema) return [];
  const object = jsonSchema(schema, "input");
  const properties = object["properties"];
  if (typeof properties !== "object" || properties === null) return [];
  const required = Array.isArray(object["required"]) ? object["required"] : [];
  return Object.entries(properties).map(([name, value]) => ({
    name,
    in: location,
    required: location === "path" || required.includes(name),
    schema: value,
    ...(typeof value === "object" &&
    value !== null &&
    "description" in value &&
    typeof value.description === "string"
      ? { description: value.description }
      : {}),
  }));
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Endpoint = ReturnType<typeof endpointPolicy>;

const refreshCookieOperations = new Set<EndpointId>([
  "auth.login",
  "auth.refresh",
  "auth.logout",
]);

const refreshCookieModes =
  "Refresh token transport is set by REFRESH_TOKEN_TRANSPORT. " +
  "body (default): the refresh token travels in JSON. " +
  "cookie: login and refresh set it as an httpOnly cookie scoped to /api/auth and omit it from the response body; " +
  'refresh and logout read the cookie when the body has no refreshToken, and then require the X-Requested-With header (send credentials: "include" cross-origin). ' +
  "A refreshToken in the body always takes precedence.";

/** Documents both refresh token transports on the endpoints that issue or consume it. */
function documentRefreshCookie(id: EndpointId, operation: JsonObject): void {
  operation["description"] = refreshCookieModes;
  if (id !== "auth.login") {
    const current = operation["parameters"];
    operation["parameters"] = [
      ...(Array.isArray(current) ? current : []),
      {
        name: "X-Requested-With",
        in: "header",
        required: false,
        schema: { type: "string" },
        description:
          "Required (any value) when the refresh token comes from the cookie",
      },
    ];
  }
  const responses = operation["responses"];
  if (!isJsonObject(responses)) return;
  for (const response of Object.values(responses))
    if (isJsonObject(response))
      response["headers"] = {
        "Set-Cookie": {
          description:
            id === "auth.logout"
              ? "Cookie mode only: clears the refresh cookie"
              : "Cookie mode only: httpOnly refresh token cookie (Path=/api/auth)",
          schema: { type: "string" },
        },
      };
}

// Errors an endpoint can return beyond what its policy implies.
const endpointErrors: Partial<Record<EndpointId, Record<number, string>>> = {
  "ready.get": { 503: "Database or Redis rate-limit store is unavailable" },
  "docs.moduleSpec": { 404: "Unknown documentation module" },
  "auth.register": { 409: "Email already registered" },
  "auth.login": { 401: "Invalid email or password" },
  "auth.refresh": {
    400: "No refreshToken in the body and no refresh cookie",
    401: "Unknown, expired, replayed or revoked refresh token",
    403: "Refresh cookie sent without the X-Requested-With header",
  },
  "auth.logout": {
    400: "No refreshToken in the body and no refresh cookie",
    403: "Refresh cookie sent without the X-Requested-With header",
  },
  "notification.create": { 404: "Recipient not found" },
  "notification.stream": {
    400: "Unknown or foreign Last-Event-ID cursor",
    429: "Too many open notification streams",
  },
};

/**
 * Error responses derived from what the request pipeline actually enforces:
 * validation/parsers, authentication, permissions, path lookups, write
 * conflicts, body limits, rate limiting and the generic 500 handler.
 */
function errorResponses(id: EndpointId, endpoint: Endpoint): JsonObject {
  const codes = new Map<number, string>();
  if (endpoint.body || endpoint.query || endpoint.params || endpoint.multipart)
    codes.set(400, "Validation failed or malformed request");
  if (endpoint.access.kind === "internal") {
    codes.set(
      401,
      "Missing, invalid or expired access token, or inactive user",
    );
    if (endpoint.access.permission)
      codes.set(403, "Missing permission or privilege for this operation");
    if (endpoint.method !== "GET")
      codes.set(409, "Conflicting or still-referenced resource");
  }
  if (endpoint.params) codes.set(404, "Resource not found");
  if (endpoint.body || endpoint.multipart)
    codes.set(413, "Request body too large");
  codes.set(429, "Rate limit exceeded");
  codes.set(500, "Unexpected server error");
  for (const [code, description] of Object.entries(endpointErrors[id] ?? {}))
    codes.set(Number(code), description);
  return Object.fromEntries(
    [...codes.entries()]
      .sort(([a], [b]) => a - b)
      .map(([code, description]) => [
        String(code),
        {
          description,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      ]),
  );
}

export function activeDocModules(): string[] {
  return [
    ...new Set(
      Object.values(endpointRegistry)
        .filter(
          (endpoint) => env.UPLOAD_ENABLED || endpoint.module !== "upload",
        )
        .map((endpoint) => endpoint.module),
    ),
  ].sort();
}

export function generateOpenApi(moduleName?: string): JsonObject {
  const paths: Record<string, Record<string, JsonObject>> = {};
  for (const id of Object.keys(endpointRegistry) as EndpointId[]) {
    const endpoint = endpointPolicy(id);
    if (!env.UPLOAD_ENABLED && endpoint.module === "upload") continue;
    if (moduleName && endpoint.module !== moduleName) continue;
    const path = endpoint.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const pathItem = paths[path] ?? {};
    const operation: JsonObject = {
      operationId: id,
      summary: endpoint.summary,
      tags: [endpoint.module],
      parameters: [
        ...parameters(endpoint.params, "path"),
        ...parameters(endpoint.query, "query"),
      ],
      responses: {
        [endpoint.status]:
          endpoint.status === 204
            ? { description: "No content" }
            : {
                description: "Success",
                content:
                  endpoint.contentType === "text/html"
                    ? { "text/html": { schema: { type: "string" } } }
                    : {
                        "application/json": {
                          schema: endpoint.response
                            ? jsonSchema(endpoint.response)
                            : { type: "object" },
                        },
                      },
              },
      },
      "x-audit-mode": endpoint.audit,
      "x-rate-limit-group": endpoint.rateLimit,
      "x-cache-mode": endpoint.cache,
    };
    if (endpoint.access.kind === "internal")
      operation["security"] = [{ bearerAuth: [] }];
    if (id === "notification.list")
      operation["responses"] = {
        200: {
          description: "Ordered notification page",
          headers: {
            "X-Next-Cursor": {
              description: "UUID cursor for next page, absent on final page",
              schema: { type: "string", format: "uuid" },
            },
          },
          content: {
            "application/json": {
              schema: endpoint.response ? jsonSchema(endpoint.response) : {},
            },
          },
        },
      };
    if (id === "notification.stream") {
      operation["parameters"] = [
        {
          name: "Last-Event-ID",
          in: "header",
          required: false,
          schema: { type: "string", format: "uuid" },
          description:
            "Last notification UUID belonging to the authenticated recipient",
        },
      ];
      operation["responses"] = {
        200: {
          description:
            "Notification SSE; UUID event IDs, heartbeat 15s, polling 3s, ordered replay in batches of 50",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
      };
    }
    if (endpoint.body)
      operation["requestBody"] = {
        required: true,
        content: {
          "application/json": { schema: jsonSchema(endpoint.body, "input") },
        },
      };
    if (endpoint.multipart)
      operation["requestBody"] = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: { file: { type: "string", format: "binary" } },
            },
          },
        },
      };
    if (refreshCookieOperations.has(id)) documentRefreshCookie(id, operation);
    const responses = operation["responses"];
    operation["responses"] = {
      ...(isJsonObject(responses) ? responses : {}),
      ...errorResponses(id, endpoint),
    };
    pathItem[endpoint.method.toLowerCase()] = operation;
    paths[path] = pathItem;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: moduleName ? `${moduleName} API` : "Modular Express API",
      version: "1.0.0",
    },
    servers: [{ url: "/" }],
    paths,
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["success", "message", "errors"],
          properties: {
            success: { type: "boolean", const: false },
            message: { type: "string" },
            errors: {
              type: "array",
              description: "Validation issues; empty for other errors",
              items: {},
            },
          },
        },
      },
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  };
}
