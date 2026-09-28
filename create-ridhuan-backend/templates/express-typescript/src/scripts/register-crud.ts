import fs from "node:fs";
import path from "node:path";

export function registerCrudModule(
  name: string,
  plural: string,
  pascal: string,
  camel: string,
  permissionConst: string,
): void {
  const registryPath = path.resolve("src/core/http/endpoint-registry.ts");
  const appPath = path.resolve("src/app.ts");
  let registry = fs.readFileSync(registryPath, "utf8");
  const response = `${camel}ResponseSchema`;
  const imports = `import { create${pascal}Schema, update${pascal}Schema, search${pascal}Schema, ${camel}IdSchema, ${response} } from "../../modules/${name}/${name}.schema.js";
import { ${permissionConst} } from "../../constants/permissions.constants.js";
`;
  const entries = [
    [
      ".list",
      "GET",
      "",
      "VIEW",
      "none",
      "read",
      200,
      `query: search${pascal}Schema, response: success(z.array(${response}))`,
    ],
    [
      ".get",
      "GET",
      "/:id",
      "VIEW",
      "none",
      "read",
      200,
      `params: ${camel}IdSchema, response: success(${response})`,
    ],
    [
      ".create",
      "POST",
      "",
      "CREATE",
      "required",
      "off",
      201,
      `body: create${pascal}Schema, response: success(${response})`,
    ],
    [
      ".update",
      "PATCH",
      "/:id",
      "UPDATE",
      "required",
      "off",
      200,
      `params: ${camel}IdSchema, body: update${pascal}Schema, response: success(${response})`,
    ],
    [
      ".delete",
      "DELETE",
      "/:id",
      "DELETE",
      "required",
      "off",
      204,
      `params: ${camel}IdSchema, response: noContent`,
    ],
  ] as const;
  const lines = entries.map(
    ([suffix, method, pathSuffix, permission, audit, cache, status, schemas]) =>
      `  "${name}${suffix}": { method: "${method}", path: "/api/${plural}${pathSuffix}", module: "${name}", summary: "${pascal} ${suffix.slice(1)}", access: { kind: "internal", permission: ${permissionConst}.${permission} }, audit: "${audit}", rateLimit: "internal", cache: "${cache}", status: ${status}, ${schemas} },`,
  );
  const importMarker = "const isoDate =";
  const endMarker = "} as const satisfies Record<string, EndpointDefinition>;";
  if (![importMarker, endMarker].every((marker) => registry.includes(marker))) {
    throw new Error("Endpoint registry markers are missing");
  }
  registry = registry.replace(importMarker, imports + importMarker);
  registry = registry.replace(endMarker, lines.join("\n") + "\n" + endMarker);
  fs.writeFileSync(registryPath, registry);

  let app = fs.readFileSync(appPath, "utf8");
  const appMarker = "const app = express();";
  const callMarker = "assertEndpointCoverage();";
  if (!app.includes(appMarker) || !app.includes(callMarker))
    throw new Error("App registration markers are missing");
  app = app.replace(
    appMarker,
    `import { register${pascal}Routes } from "./modules/${name}/${name}.routes.js";\n\n` +
      appMarker,
  );
  app = app.replace(callMarker, `register${pascal}Routes(app);\n` + callMarker);
  fs.writeFileSync(appPath, app);
}
