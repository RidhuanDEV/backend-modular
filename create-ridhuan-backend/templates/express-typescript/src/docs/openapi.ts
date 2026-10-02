import { z, type ZodType } from "zod";
import {
  endpointRegistry,
  endpointPolicy,
  type EndpointId,
} from "../core/http/endpoint-registry.js";
import { env } from "../config/env.js";

type JsonObject = Record<string, unknown>;
function jsonSchema(schema: ZodType): JsonObject {
  const converted: JsonObject = z.toJSONSchema(schema, {
    unrepresentable: "any",
  });
  delete converted["$schema"];
  return converted;
}
function parameters(
  schema: ZodType | undefined,
  location: "path" | "query",
): JsonObject[] {
  if (!schema) return [];
  const object = jsonSchema(schema);
  const properties = object["properties"];
  if (typeof properties !== "object" || properties === null) return [];
  const required = Array.isArray(object["required"]) ? object["required"] : [];
  return Object.entries(properties).map(([name, value]) => ({
    name,
    in: location,
    required: location === "path" || required.includes(name),
    schema: value,
  }));
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
        400: { description: "Unknown or foreign cursor" },
      };
    }
    if (endpoint.body)
      operation["requestBody"] = {
        required: true,
        content: { "application/json": { schema: jsonSchema(endpoint.body) } },
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
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  };
}
