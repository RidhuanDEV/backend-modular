import { RequestMethod } from "@nestjs/common";
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import {
  ENDPOINT_ID_METADATA,
  endpointRegistry,
  type EndpointId,
} from "./endpoint.registry";

function normalize(value: string): string {
  return (
    `/${value}`
      .replace(/\/+/g, "/")
      .replace(/:\w+/g, (item) => `{${item.slice(1)}}`)
      .replace(/\/$/, "") || "/"
  );
}
export function verifyRegisteredControllers(modules: ModulesContainer): void {
  const found = new Set<EndpointId>();
  for (const module of modules.values())
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const base = Reflect.getMetadata(PATH_METADATA, controller) as unknown;
      if (typeof base !== "string")
        throw new Error(`Invalid controller path: ${controller.name}`);
      for (const key of Object.getOwnPropertyNames(controller.prototype)) {
        if (key === "constructor") continue;
        const method: unknown = Reflect.getMetadata(
          METHOD_METADATA,
          controller.prototype[key],
        );
        if (method === undefined) continue;
        const id = Reflect.getMetadata(
          ENDPOINT_ID_METADATA,
          controller.prototype[key],
        ) as EndpointId | undefined;
        if (!id || !(id in endpointRegistry))
          throw new Error(`Missing registry entry: ${controller.name}.${key}`);
        if (found.has(id)) throw new Error(`Duplicate endpoint ID: ${id}`);
        found.add(id);
        const path = Reflect.getMetadata(
          PATH_METADATA,
          controller.prototype[key],
        ) as unknown;
        if (typeof path !== "string")
          throw new Error(`Invalid action path: ${id}`);
        const expected = endpointRegistry[id];
        const actualMethod = RequestMethod[method as RequestMethod];
        if (
          actualMethod !== expected.method ||
          normalize(`${base}/${path}`) !== expected.path
        ) {
          throw new Error(`Registry route mismatch: ${id}`);
        }
        const explicitStatus: unknown = Reflect.getMetadata(
          HTTP_CODE_METADATA,
          controller.prototype[key],
        );
        const actualStatus =
          typeof explicitStatus === "number"
            ? explicitStatus
            : actualMethod === "POST"
              ? 201
              : 200;
        if (actualStatus !== expected.status)
          throw new Error(`Registry status mismatch: ${id}`);
      }
    }
  for (const id of Object.keys(endpointRegistry) as EndpointId[]) {
    if (id === "docs.ui" || id === "docs.spec") continue; // Swagger mounts its own UI and JSON handlers.
    if (!found.has(id))
      throw new Error(`Registry endpoint has no controller: ${id}`);
  }
}

export function verifyOpenApi(document: OpenAPIObject): void {
  const seen = new Set<string>();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of ["get", "post", "patch", "delete"] as const) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      const id = operation.operationId;
      if (!id || !(id in endpointRegistry))
        throw new Error(
          `Undeclared OpenAPI operation: ${method.toUpperCase()} ${path}`,
        );
      const expected = endpointRegistry[id as EndpointId];
      if (expected.method.toLowerCase() !== method || expected.path !== path)
        throw new Error(`OpenAPI route mismatch: ${id}`);
      if (seen.has(id)) throw new Error(`Duplicate OpenAPI operation: ${id}`);
      seen.add(id);
    }
  }
  for (const id of Object.keys(endpointRegistry))
    if (!seen.has(id)) throw new Error(`OpenAPI is missing endpoint: ${id}`);
}
