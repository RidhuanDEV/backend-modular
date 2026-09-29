import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export async function generateFeature(projectRoot: string, name: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Feature name must use lowercase letters, numbers and hyphens");
  const root = resolve(projectRoot);
  const directory = resolve(root, "src", "modules", name);
  if (!directory.startsWith(`${resolve(root, "src", "modules")}${sep}`)) throw new Error("Feature path is outside modules");
  const className = name.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
  const moduleName = `${className}Module`;
  const appPath = join(root, "src", "app.module.ts");
  const appSource = await readFile(appPath, "utf8");
  if (appSource.includes(`/${name}/${name}.module`)) throw new Error("Feature is already registered");
  const marker = "@Module({";
  if (!appSource.includes(marker) || !appSource.includes("  imports: [")) throw new Error("AppModule layout is not recognized");
  await mkdir(directory);
  await writeFile(join(directory, `${name}.module.ts`), `import { Module } from "@nestjs/common";\nimport { ${className}Controller } from "./${name}.controller";\nimport { ${className}Service } from "./${name}.service";\n@Module({ controllers: [${className}Controller], providers: [${className}Service] })\nexport class ${moduleName} {}\n`, { flag: "wx" });
  await writeFile(join(directory, `${name}.controller.ts`), `import { Controller } from "@nestjs/common";\nimport { ApiTags } from "@nestjs/swagger";\n@ApiTags("${name}") @Controller("api/${name}")\nexport class ${className}Controller {\n  // Add routes only after defining DTO, registry ID and permission contract.\n}\n`, { flag: "wx" });
  await writeFile(join(directory, `${name}.service.ts`), `import { Injectable } from "@nestjs/common";\n@Injectable()\nexport class ${className}Service {\n  // Implement a business use case with explicit input and output types.\n}\n`, { flag: "wx" });
  await writeFile(join(directory, `${name}.dto.ts`), `// Define request classes with class-validator decorators and explicit public response fields.\nexport class ${className}ResponseDto {\n  id!: string;\n}\n`, { flag: "wx" });
  await writeFile(join(directory, `${name}.policy.ts`), `import type { EndpointDefinition } from "../../common/endpoint/endpoint.registry";\n// Register each real route in endpointRegistry and apply @Endpoint on its controller method.\nexport const ${name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}DefaultPolicy = { audit: "required", rateLimit: "internal", cache: "off" } as const satisfies Pick<EndpointDefinition, "audit" | "rateLimit" | "cache">;\n`, { flag: "wx" });
  const next = appSource.replace(marker, `import { ${moduleName} } from "./modules/${name}/${name}.module";\n\n${marker}`)
    .replace("  imports: [", `  imports: [${moduleName}, `);
  await writeFile(appPath, next);
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) { process.stderr.write("Usage: npm run generate:feature -- feature-name\n"); process.exitCode = 1; }
  else generateFeature(process.cwd(), name).then(() => process.stdout.write(`Created ${name}\n`))
    .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Generation failed"}\n`); process.exitCode = 1; });
}
