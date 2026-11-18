import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
} from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import {
  endpointRegistry,
  type EndpointDefinition,
  type EndpointId,
} from "./endpoint.registry";

const methods = ["get", "post", "patch", "delete"] as const;

function isEndpointId(id: string | undefined): id is EndpointId {
  return id !== undefined && Object.hasOwn(endpointRegistry, id);
}

function isParameter(
  value: ParameterObject | ReferenceObject,
): value is ParameterObject {
  return !("$ref" in value);
}

// Errors an endpoint can return beyond what its registry definition implies.
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
  "upload.create": { 503: "Uploads are disabled" },
  "notification.create": { 404: "Recipient not found" },
  "notification.stream": {
    400: "Unknown or foreign Last-Event-ID cursor",
    429: "Too many open notification streams",
  },
};

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
function documentRefreshCookie(
  id: EndpointId,
  operation: OperationObject,
): void {
  operation.description = refreshCookieModes;
  if (id !== "auth.login")
    operation.parameters = [
      ...(operation.parameters ?? []),
      {
        name: "X-Requested-With",
        in: "header",
        required: false,
        schema: { type: "string" },
        description:
          "Required (any value) when the refresh token comes from the cookie",
      },
    ];
  for (const [code, response] of Object.entries(operation.responses))
    if (Number(code) < 300 && response && !("$ref" in response))
      response.headers = {
        ...response.headers,
        "Set-Cookie": {
          description:
            id === "auth.logout"
              ? "Cookie mode only: clears the refresh cookie"
              : "Cookie mode only: httpOnly refresh token cookie (Path=/api/auth)",
          schema: { type: "string" },
        },
      };
}

/**
 * Error responses derived from what the request pipeline actually enforces:
 * ValidationPipe/body parser, AccessGuard authentication and permissions, path
 * lookups, write conflicts (Prisma P2002/P2003), body limits, rate limiting
 * and the generic 500 filter.
 */
function errorResponses(
  id: EndpointId,
  definition: EndpointDefinition,
  operation: OperationObject,
  path: string,
): OperationObject["responses"] {
  const parameters = (operation.parameters ?? []).filter(isParameter);
  const hasQuery = parameters.some((parameter) => parameter.in === "query");
  const hasPath = path.includes("{");
  const hasBody = operation.requestBody !== undefined;
  const codes = new Map<number, string>();
  if (hasQuery || hasPath || hasBody)
    codes.set(400, "Validation failed or malformed request");
  if (!definition.public) {
    codes.set(
      401,
      "Missing, invalid or expired access token, or inactive user",
    );
    if (definition.permission)
      codes.set(403, "Missing permission or privilege for this operation");
    if (definition.method !== "GET")
      codes.set(409, "Conflicting or still-referenced resource");
  }
  if (hasPath) codes.set(404, "Resource not found");
  if (hasBody) codes.set(413, "Request body too large");
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

/**
 * Completes the generated document: query parameters that have server defaults
 * are optional, and every operation lists the errors it can actually return.
 */
export function documentContract(document: OpenAPIObject): void {
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ErrorResponse: {
        type: "object",
        required: ["success", "message", "errors"],
        properties: {
          success: { type: "boolean", enum: [false] },
          message: { type: "string" },
          errors: {
            type: "array",
            description: "Validation issues; empty for other errors",
            items: {},
          },
        },
      },
    },
  };
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation || !isEndpointId(operation.operationId)) continue;
      for (const parameter of (operation.parameters ?? []).filter(isParameter))
        if (
          parameter.in === "query" &&
          parameter.schema &&
          !("$ref" in parameter.schema) &&
          parameter.schema.default !== undefined
        )
          parameter.required = false;
      if (refreshCookieOperations.has(operation.operationId))
        documentRefreshCookie(operation.operationId, operation);
      operation.responses = {
        ...operation.responses,
        ...errorResponses(
          operation.operationId,
          endpointRegistry[operation.operationId],
          operation,
          path,
        ),
      };
    }
  }
}
