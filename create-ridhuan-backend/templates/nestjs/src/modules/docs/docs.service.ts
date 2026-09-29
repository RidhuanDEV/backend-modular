import { Injectable } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";

@Injectable()
export class DocsService {
  private document?: OpenAPIObject;
  setDocument(document: OpenAPIObject): void { this.document = document; }
  getDocument(): OpenAPIObject {
    if (!this.document) throw new Error("OpenAPI document has not been initialized");
    return this.document;
  }
  moduleSpec(module: string): OpenAPIObject | undefined {
    const source = this.document;
    if (!source || !["system", "docs", "auth", "users", "roles", "permissions", "upload", "notifications"].includes(module)) return undefined;
    const paths: OpenAPIObject["paths"] = {};
    for (const [path, operations] of Object.entries(source.paths)) {
      const matches = Object.values(operations ?? {}).some((operation) => {
        if (!operation || typeof operation !== "object" || !("tags" in operation)) return false;
        return Array.isArray(operation.tags) && operation.tags.includes(module);
      });
      if (matches) paths[path] = operations;
    }
    return { ...source, paths };
  }
}
