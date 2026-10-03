import { registerCrudModule } from "./register-crud.js";
import fs from "node:fs";
import path from "node:path";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, "src");
const CONSTANTS = path.join(SRC, "constants");
const MODULES = path.join(SRC, "modules");
const MODULE_CONSTANTS_FILE = path.join(CONSTANTS, "modules.constants.ts");
const PERMISSION_CONSTANTS_FILE = path.join(
  CONSTANTS,
  "permissions.constants.ts",
);
const POSTMAN = path.join(ROOT, "postman", "api.collection.json");

function kebabCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function pascalCase(s: string): string {
  return s
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function camelCase(s: string): string {
  const p = pascalCase(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function constantCase(s: string): string {
  return kebabCase(s).replace(/-/g, "_").toUpperCase();
}

function pluralize(s: string): string {
  if (s.endsWith("y") && !/[aeiou]y$/i.test(s)) {
    return s.slice(0, -1) + "ies";
  }
  if (
    s.endsWith("s") ||
    s.endsWith("x") ||
    s.endsWith("z") ||
    s.endsWith("ch") ||
    s.endsWith("sh")
  ) {
    return s + "es";
  }
  return s + "s";
}

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`  created: ${path.relative(ROOT, filePath)}`);
}

type ModuleConstantMap = Record<string, string>;
type PermissionGroupMap = Record<string, Record<string, string>>;

const DEFAULT_MODULE_CONSTANTS: ModuleConstantMap = {
  AUTH: "auth",
  USER: "user",
  ROLE: "role",
  PERMISSION: "permission",
};

const DEFAULT_PERMISSION_GROUPS: PermissionGroupMap = {
  USER: {
    MANAGE: "manage_users",
  },
  ROLE: {
    MANAGE: "manage_roles",
  },
  PERMISSION: {
    MANAGE: "manage_permissions",
  },
  UPLOAD: {
    MANAGE: "manage_uploads",
  },
  NOTIFICATION: {
    MANAGE: "manage_notifications",
  },
};

function preferredConstantOrder(keys: string[]): string[] {
  const preferred = ["AUTH", "USER", "ROLE", "PERMISSION"];
  const preferredKeys = preferred.filter((key) => keys.includes(key));
  const otherKeys = keys.filter((key) => !preferred.includes(key)).sort();
  return [...preferredKeys, ...otherKeys];
}

function renderModuleConstants(constantsMap: ModuleConstantMap): string {
  const keys = preferredConstantOrder(Object.keys(constantsMap));

  return `export const MODULES = {
${keys.map((key) => `  ${key}: "${constantsMap[key]}",`).join("\n")}
} as const;

export type ModuleName = typeof MODULES[keyof typeof MODULES];

${keys.map((key) => `export const ${key}_MODULE = MODULES.${key};`).join("\n")}
`;
}

function renderPermissionConstants(groups: PermissionGroupMap): string {
  const keys = preferredConstantOrder(Object.keys(groups));

  const groupLines = keys
    .map((key) => {
      const permissions = groups[key] ?? {};
      const permissionLines = Object.entries(permissions)
        .map(([action, value]) => `    ${action}: "${value}",`)
        .join("\n");

      return `  ${key}: {
${permissionLines}
  },`;
    })
    .join("\n");

  return `export const PERMISSION_GROUPS = {
${groupLines}
} as const;

type PermissionGroups = typeof PERMISSION_GROUPS;

export type PermissionName = {
  [K in keyof PermissionGroups]:
    PermissionGroups[K][keyof PermissionGroups[K]];
}[keyof PermissionGroups];

${keys.map((key) => `export const ${key}_PERMISSIONS = PERMISSION_GROUPS.${key};`).join("\n")}
`;
}

function parseModuleConstants(content: string): ModuleConstantMap {
  const result: ModuleConstantMap = {};
  const regex = /^\s*([A-Z_0-9]+):\s*["']([^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    const val = match[2];
    if (key && val) {
      result[key] = val;
    }
  }
  return result;
}

function parsePermissionGroups(content: string): PermissionGroupMap {
  const result: PermissionGroupMap = {};
  const groupRegex = /^\s*([A-Z_0-9]+):\s*\{([^}]+)\}/gm;
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupRegex.exec(content)) !== null) {
    const groupKey = groupMatch[1];
    const groupBody = groupMatch[2];
    if (groupKey && groupBody) {
      const innerMap: Record<string, string> = {};
      const innerRegex = /\s*([A-Z_0-9]+):\s*["']([^"']+)["']/g;
      let innerMatch: RegExpExecArray | null;
      while ((innerMatch = innerRegex.exec(groupBody)) !== null) {
        const key = innerMatch[1];
        const val = innerMatch[2];
        if (key && val) {
          innerMap[key] = val;
        }
      }
      result[groupKey] = innerMap;
    }
  }
  return result;
}

function readModuleConstants(): ModuleConstantMap {
  if (!fs.existsSync(MODULE_CONSTANTS_FILE)) {
    return { ...DEFAULT_MODULE_CONSTANTS };
  }
  const content = fs.readFileSync(MODULE_CONSTANTS_FILE, "utf-8");
  return parseModuleConstants(content);
}

function readPermissionGroups(): PermissionGroupMap {
  if (!fs.existsSync(PERMISSION_CONSTANTS_FILE)) {
    return { ...DEFAULT_PERMISSION_GROUPS };
  }
  const content = fs.readFileSync(PERMISSION_CONSTANTS_FILE, "utf-8");
  return parsePermissionGroups(content);
}

function moduleConstantName(name: string): string {
  return `${constantCase(name)}_MODULE`;
}

function permissionConstantName(name: string): string {
  return `${constantCase(name)}_PERMISSIONS`;
}

function ensureConstantFiles(name: string): void {
  const key = constantCase(name);

  const modules = readModuleConstants();
  modules[key] = name;
  writeFile(MODULE_CONSTANTS_FILE, renderModuleConstants(modules));

  const permissionGroups = readPermissionGroups();
  permissionGroups[key] = {
    CREATE: `create_${name}`,
    UPDATE: `update_${name}`,
    DELETE: `delete_${name}`,
    VIEW: `view_${name}`,
  };
  writeFile(
    PERMISSION_CONSTANTS_FILE,
    renderPermissionConstants(permissionGroups),
  );
}

// ─── Validators ─────────────────────────────────────────────────────────────

function validateModuleName(name: string): string {
  const kebab = kebabCase(name);
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(kebab)) {
    console.error(
      `Error: Invalid module name "${name}". Use kebab-case (e.g., "user" or "blog-post").`,
    );
    process.exit(1);
  }
  return kebab;
}

// ─── Template Generators ────────────────────────────────────────────────────

function genSchema(name: string): string {
  const pascal = pascalCase(name);
  return `import { z } from 'zod';

export const create${pascal}Schema = z.object({
  // Define your create fields here
});

export const update${pascal}Schema = create${pascal}Schema.partial();

export const search${pascal}Schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  orderBy: z.enum(['asc', 'desc']).optional(),
  /** Comma-separated response/model field names to include in list results. */
  fields: z.string().optional(),
});

export const ${camelCase(name)}IdSchema = z.object({
  id: z.string().uuid(),
});

export const ${camelCase(name)}ResponseSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).passthrough();
`;
}

function genCreateDto(name: string): string {
  const pascal = pascalCase(name);
  return `import type { z } from 'zod';
import type { create${pascal}Schema } from '../${name}.schema.js';

export type Create${pascal}Dto = z.infer<typeof create${pascal}Schema>;
`;
}

function genUpdateDto(name: string): string {
  const pascal = pascalCase(name);
  return `import type { z } from 'zod';
import type { update${pascal}Schema } from '../${name}.schema.js';

export type Update${pascal}Dto = z.infer<typeof update${pascal}Schema>;
`;
}

function genSearchDto(name: string): string {
  const pascal = pascalCase(name);
  return `import type { z } from 'zod';
import type { search${pascal}Schema } from '../${name}.schema.js';

export type Search${pascal}Dto = z.infer<typeof search${pascal}Schema>;
`;
}

function genResponseDto(name: string): string {
  const pascal = pascalCase(name);
  return `export interface ${pascal}ResponseDto {
  id: string;
  /** ISO 8601 string — matches the actual JSON serialisation over HTTP. */
  createdAt: string;
  updatedAt: string;
}

export type ${pascal}ResponseProjection = Partial<${pascal}ResponseDto>;
`;
}

function genRepository(name: string): string {
  const pascal = pascalCase(name);
  return `import type { Prisma, ${pascal} } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import type { Create${pascal}Dto } from './dto/create-${name}.dto.js';
import type { Update${pascal}Dto } from './dto/update-${name}.dto.js';
import type { PrismaFindOptions } from '../../core/database/query-builder.js';

type TransactionClient = Prisma.TransactionClient;

export class ${pascal}Repository {
  async findAll(options: PrismaFindOptions): Promise<{ rows: ${pascal}[]; count: number }> {
    const [rows, count] = await Promise.all([
      prisma.${camelCase(name)}.findMany({
        where: options.where,
        skip: options.skip,
        take: options.take,
        orderBy: options.orderBy,
      }),
      prisma.${camelCase(name)}.count({ where: options.where }),
    ]);
    return { rows, count };
  }

  async findById(id: string, trx?: TransactionClient): Promise<${pascal} | null> {
    const client = trx ?? prisma;
    return client.${camelCase(name)}.findUnique({
      where: { id },
    });
  }

  async create(data: Create${pascal}Dto, trx?: TransactionClient): Promise<${pascal}> {
    const client = trx ?? prisma;
    return client.${camelCase(name)}.create({
      data,
    });
  }

  async update(id: string, data: Update${pascal}Dto, trx?: TransactionClient): Promise<${pascal} | null> {
    const client = trx ?? prisma;
    const existing = await client.${camelCase(name)}.findUnique({ where: { id } });
    if (!existing) return null;
    return client.${camelCase(name)}.update({
      where: { id },
      data,
    });
  }

  async delete(id: string, trx?: TransactionClient): Promise<boolean> {
    const client = trx ?? prisma;
    try {
      await client.${camelCase(name)}.delete({
        where: { id },
      });
      return true;
    } catch {
      return false;
    }
  }
}
`;
}

function genQuery(name: string): string {
  const pascal = pascalCase(name);
  const camel = camelCase(name);
  return `import type { QueryBuilderConfig } from '../../../core/database/query-builder.js';

/**
 * Query builder config for ${pascal}.
 *
 * Use Prisma model field names here (camelCase).
 *
 * searchFields:    Model fields searched with \`contains\` when ?search= is provided.
 * sortableFields:  Allowlist of model fields valid for ?sortBy=. Any field not in
 *                  this list silently falls back to createdAt.
 * selectableFields: Allowlist for ?fields= field selection. Only these fields
 *                  can be returned, preventing internal/sensitive column leaks.
 * filters:         Maps query-param key to model field + Prisma operator.
 * defaultIncludes: Eager-loaded relations to prevent N+1 queries.
 */
export const ${camel}QueryConfig: QueryBuilderConfig = {
  searchFields: [
    // 'name',
    // 'description',
  ],
  sortableFields: [
    'createdAt',
    'updatedAt',
    // 'name',
  ],
  selectableFields: [
    'id',
    'createdAt',
    'updatedAt',
    // 'name',
  ],
  filters: {
    // yearMin:       { column: 'year',       type: 'number', operator: 'gte' },
    // yearMax:       { column: 'year',       type: 'number', operator: 'lte' },
    // isActive:      { column: 'isActive',   type: 'boolean' },
    // createdAfter:  { column: 'createdAt',  type: 'date',   operator: 'gte' },
    // createdBefore: { column: 'createdAt',  type: 'date',   operator: 'lte' },
  },
  defaultIncludes: {},
};
`;
}

function genMapper(name: string): string {
  const pascal = pascalCase(name);
  return `import type { ${pascal} } from '@prisma/client';
import type { ${pascal}ResponseDto, ${pascal}ResponseProjection } from '../dto/${name}-response.dto.js';

/**
 * Maps a Prisma ${pascal} model to ${pascal}ResponseDto.
 *
 * This function is the **API contract boundary**: changes to DB column names
 * should be handled here, never in the controller or service, so the
 * response shape stays stable for API consumers.
 *
 * Dates are serialised to ISO 8601 strings to match JSON output exactly.
 */
export function to${pascal}Response(model: ${pascal}): ${pascal}ResponseDto {
  return {
    id: model.id,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
    // Map additional fields here:
    // name: model.name,
  };
}

export function to${pascal}ResponseList(models: ${pascal}[]): ${pascal}ResponseProjection[] {
  return models.map((model) => {
    return {
      id: model.id,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
      // Map additional fields here:
      // name: model.name,
    };
  });
}
`;
}

function genPolicy(name: string): string {
  const pascal = pascalCase(name);
  const camel = camelCase(name);
  return `import type { JwtUserPayload } from '../../../types/index.js';
import type { ${pascal} } from '@prisma/client';

/**
 * Resource-level authorization policy for ${pascal}.
 *
 * Route-level RBAC (view_${name}, create_${name}, etc.) is handled by
 * requirePermission() middleware. Use this class for ownership checks
 * or additional business rules that need the loaded resource.
 *
 * Throw HttpError.forbidden() to deny access, return void to allow.
 */
export class ${pascal}Policy {
  canView(_user: JwtUserPayload, _resource?: ${pascal}): void {
    // Add resource-level checks here if needed.
  }

  canCreate(_user: JwtUserPayload): void {
    // Add creation business rules here if needed.
  }

  canUpdate(_user: JwtUserPayload, _resource: ${pascal}): void {
    // Example: throw HttpError.forbidden('...') when user cannot update.
  }

  canDelete(_user: JwtUserPayload, _resource: ${pascal}): void {
    // Example: throw HttpError.forbidden('...') when user cannot delete.
  }
}

export const ${camel}Policy = new ${pascal}Policy();
`;
}

function genService(name: string): string {
  const pascal = pascalCase(name);
  const camel = camelCase(name);
  const moduleConst = moduleConstantName(name);
  return `import { ${pascal}Repository } from './${name}.repository.js';
import { prisma } from '../../config/prisma.js';
import { cacheService } from '../../core/cache/cache.service.js';
import { auditService } from '../../core/audit/audit.service.js';
import { HttpError } from '../../core/errors/http-error.js';
import { buildFindOptions } from '../../core/database/query-builder.js';
import { buildPaginationMeta } from '../../utils/pagination.js';
import { AuditAction } from '../../constants/audit.constants.js';
import { ${moduleConst} } from '../../constants/modules.constants.js';
import { to${pascal}Response, to${pascal}ResponseList } from './mappers/${name}.mapper.js';
import { ${camel}Policy } from './policies/${name}.policy.js';
import { ${camel}QueryConfig } from './queries/${name}.query.js';
import type { Create${pascal}Dto } from './dto/create-${name}.dto.js';
import type { Update${pascal}Dto } from './dto/update-${name}.dto.js';
import type { Search${pascal}Dto } from './dto/search-${name}.dto.js';
import { ${camel}ResponseSchema } from './${name}.schema.js';
import { paginationCacheSchema } from '../../core/cache/cache-schemas.js';
import { z } from 'zod';
import type { JwtUserPayload, PaginationMeta } from '../../types/index.js';
import type { ${pascal}ResponseDto, ${pascal}ResponseProjection } from './dto/${name}-response.dto.js';

const repository = new ${pascal}Repository();
const CACHE_PREFIX = ${moduleConst};

export class ${pascal}Service {
  async findAll(query: Search${pascal}Dto): Promise<{ data: ${pascal}ResponseProjection[]; meta: PaginationMeta }> {
    const cacheKey = \`\${CACHE_PREFIX}:list:\${JSON.stringify(query)}\`;
    const cached = await cacheService.get(cacheKey, z.object({ data: z.array(${camel}ResponseSchema), meta: paginationCacheSchema }));
    if (cached) return cached;

    const findOptions = buildFindOptions(query, ${camel}QueryConfig);
    const { rows, count } = await repository.findAll(findOptions);
    const { page, limit } = query;

    const result = {
      data: to${pascal}ResponseList(rows),
      meta: buildPaginationMeta(page, limit, count),
    };

    await cacheService.set(cacheKey, result, 60);
    return result;
  }

  async findById(id: string): Promise<${pascal}ResponseDto> {
    const cacheKey = \`\${CACHE_PREFIX}:\${id}\`;
    const cached = await cacheService.get(cacheKey, ${camel}ResponseSchema);
    if (cached) return cached;

    const record = await repository.findById(id);
    if (!record) throw HttpError.notFound('${pascal} not found');

    const response = to${pascal}Response(record);
    await cacheService.set(cacheKey, response, 120);
    return response;
  }

  async create(data: Create${pascal}Dto, user: JwtUserPayload, requestId?: string): Promise<${pascal}ResponseDto> {
    ${camel}Policy.canCreate(user);

    const record = await prisma.$transaction(async (tx) => {
      const created = await repository.create(data, tx);
      await auditService.persist({
        action: AuditAction.CREATE,
        module: ${moduleConst},
        entityId: created.id,
        userId: user.id,
        after: created,
        requestId,
        trx: tx,
      });
      return created;
    });

    await cacheService.invalidatePattern(\`\${CACHE_PREFIX}:list:*\`);
    return to${pascal}Response(record);
  }

  async update(id: string, data: Update${pascal}Dto, user: JwtUserPayload, requestId?: string): Promise<${pascal}ResponseDto> {
    const existing = await repository.findById(id);
    if (!existing) throw HttpError.notFound('${pascal} not found');
    ${camel}Policy.canUpdate(user, existing);

    const record = await prisma.$transaction(async (tx) => {
      const updated = await repository.update(id, data, tx);
      if (!updated) throw HttpError.notFound('${pascal} not found');
      await auditService.persist({
        action: AuditAction.UPDATE,
        module: ${moduleConst},
        entityId: id,
        userId: user.id,
        before: existing,
        after: updated,
        requestId,
        trx: tx,
      });
      return updated;
    });

    await cacheService.del(\`\${CACHE_PREFIX}:\${id}\`);
    await cacheService.invalidatePattern(\`\${CACHE_PREFIX}:list:*\`);
    return to${pascal}Response(record);
  }

  async delete(id: string, user: JwtUserPayload, requestId?: string): Promise<void> {
    const existing = await repository.findById(id);
    if (!existing) throw HttpError.notFound('${pascal} not found');
    ${camel}Policy.canDelete(user, existing);

    await prisma.$transaction(async (tx) => {
      const deleted = await repository.delete(id, tx);
      if (!deleted) throw HttpError.notFound('${pascal} not found');

      await auditService.persist({
        action: AuditAction.DELETE,
        module: ${moduleConst},
        entityId: id,
        userId: user.id,
        before: existing,
        requestId,
        trx: tx,
      });
    });

    await cacheService.del(\`\${CACHE_PREFIX}:\${id}\`);
    await cacheService.invalidatePattern(\`\${CACHE_PREFIX}:list:*\`);
  }
}
`;
}

function genController(name: string): string {
  const pascal = pascalCase(name);
  return `import type { Request, Response, NextFunction } from 'express';
import { ${pascal}Service } from './${name}.service.js';
import { requireAuthenticatedUser, requireRouteParam } from '../../core/http/request-context.js';
import { sendSuccess, sendCreated, sendNoContent } from '../../utils/response.js';
import type { Create${pascal}Dto } from './dto/create-${name}.dto.js';
import type { Update${pascal}Dto } from './dto/update-${name}.dto.js';
import type { Search${pascal}Dto } from './dto/search-${name}.dto.js';
import { create${pascal}Schema, update${pascal}Schema } from './${name}.schema.js';

const service = new ${pascal}Service();

export class ${pascal}Controller {
  getAll = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const pageVal = req.query['page'];
      const limitVal = req.query['limit'];
      const sortByVal = req.query['sortBy'];
      const orderByVal = req.query['orderBy'];
      const searchVal = req.query['search'];
      const fieldsVal = req.query['fields'];

      const query: Search${pascal}Dto = {
        page: typeof pageVal === 'number' ? pageVal : Number(pageVal) || 1,
        limit: typeof limitVal === 'number' ? limitVal : Number(limitVal) || 10,
        sortBy: typeof sortByVal === 'string' ? sortByVal : undefined,
        orderBy: orderByVal === 'desc' ? 'desc' : 'asc',
        search: typeof searchVal === 'string' ? searchVal : undefined,
        fields: typeof fieldsVal === 'string' ? fieldsVal : undefined,
      };

      const result = await service.findAll(query);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await service.findById(requireRouteParam(req, 'id'));
      sendSuccess(res, { data });
    } catch (err) {
      next(err);
    }
  };

  create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireAuthenticatedUser(req);
      const reqIdStr = req.requestId;

      const body: Create${pascal}Dto = create${pascal}Schema.parse(req.body);
      const data = await service.create(body, user, reqIdStr);
      sendCreated(res, data);
    } catch (err) {
      next(err);
    }
  };

  update = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireAuthenticatedUser(req);
      const reqIdStr = req.requestId;

      const body: Update${pascal}Dto = update${pascal}Schema.parse(req.body);
      const data = await service.update(requireRouteParam(req, 'id'), body, user, reqIdStr);
      sendSuccess(res, { data });
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = requireAuthenticatedUser(req);
      const reqIdStr = req.requestId;

      await service.delete(requireRouteParam(req, 'id'), user, reqIdStr);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  };
}
`;
}

function genRoutes(name: string): string {
  const pascal = pascalCase(name);
  return `import type { Express } from 'express';
import { ${pascal}Controller } from './${name}.controller.js';
import { mountEndpoint } from '../../core/http/mount-endpoint.js';
export function register${pascal}Routes(app: Express): void {
  const controller = new ${pascal}Controller();
  mountEndpoint(app, '${name}.list', controller.getAll);
  mountEndpoint(app, '${name}.get', controller.getById);
  mountEndpoint(app, '${name}.create', controller.create);
  mountEndpoint(app, '${name}.update', controller.update);
  mountEndpoint(app, '${name}.delete', controller.delete);
}
`;
}

// Postman collection
interface PostmanItem {
  name: string;
  request: {
    method: string;
    header: Array<{ key: string; value: string }>;
    url: { raw: string; host: string[]; path: string[] };
    body?: {
      mode: string;
      raw: string;
      options: { raw: { language: string } };
    };
  };
}

interface PostmanCollection {
  info: { name: string; schema: string };
  variable: Array<{ key: string; value: string }>;
  item: Array<{ name: string; item: PostmanItem[] }>;
}

function getOrCreateCollection(): PostmanCollection {
  if (fs.existsSync(POSTMAN)) {
    let content = fs.readFileSync(POSTMAN, "utf-8");
    if (content.startsWith("\ufeff")) {
      content = content.slice(1);
    }
    const parsed: PostmanCollection = JSON.parse(content);
    return parsed;
  }
  return {
    info: {
      name: "API Collection",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [{ key: "baseUrl", value: "http://localhost:3000/api" }],
    item: [],
  };
}

function updatePostman(name: string): void {
  const collection = getOrCreateCollection();
  const pascal = pascalCase(name);
  const plural = pluralize(name);

  if (collection.item.some((f) => f.name === pascal)) {
    console.log(`  skipped: Postman folder "${pascal}" already exists`);
    return;
  }

  const authHeader = { key: "Authorization", value: "Bearer {{token}}" };
  const jsonHeader = { key: "Content-Type", value: "application/json" };

  const folder = {
    name: pascal,
    item: [
      {
        name: `List ${pascal}`,
        request: {
          method: "GET",
          header: [authHeader],
          url: {
            raw: `{{baseUrl}}/${plural}?page=1&limit=10`,
            host: ["{{baseUrl}}"],
            path: [plural],
          },
        },
      },
      {
        name: `Get ${pascal}`,
        request: {
          method: "GET",
          header: [authHeader],
          url: {
            raw: `{{baseUrl}}/${plural}/:id`,
            host: ["{{baseUrl}}"],
            path: [plural, ":id"],
          },
        },
      },
      {
        name: `Create ${pascal}`,
        request: {
          method: "POST",
          header: [authHeader, jsonHeader],
          url: {
            raw: `{{baseUrl}}/${plural}`,
            host: ["{{baseUrl}}"],
            path: [plural],
          },
          body: {
            mode: "raw",
            raw: JSON.stringify({}, null, 2),
            options: { raw: { language: "json" } },
          },
        },
      },
      {
        name: `Update ${pascal}`,
        request: {
          method: "PATCH",
          header: [authHeader, jsonHeader],
          url: {
            raw: `{{baseUrl}}/${plural}/:id`,
            host: ["{{baseUrl}}"],
            path: [plural, ":id"],
          },
          body: {
            mode: "raw",
            raw: JSON.stringify({}, null, 2),
            options: { raw: { language: "json" } },
          },
        },
      },
      {
        name: `Delete ${pascal}`,
        request: {
          method: "DELETE",
          header: [authHeader],
          url: {
            raw: `{{baseUrl}}/${plural}/:id`,
            host: ["{{baseUrl}}"],
            path: [plural, ":id"],
          },
        },
      },
    ] as PostmanItem[],
  };

  collection.item.push(folder);
  writeFile(POSTMAN, JSON.stringify(collection, null, 2));
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const rawName = process.argv[2];

  if (!rawName) {
    console.error("Usage: npm run make:crud <module-name>");
    console.error("Example: npm run make:crud product");
    process.exit(1);
  }

  const name = validateModuleName(rawName);
  const moduleDir = path.join(MODULES, name);

  if (fs.existsSync(moduleDir)) {
    console.error(
      `Error: Module "${name}" already exists at ${path.relative(ROOT, moduleDir)}`,
    );
    process.exit(1);
  }

  console.log(`\nGenerating module: ${name}\n`);

  ensureConstantFiles(name);

  // Module files
  writeFile(path.join(moduleDir, `${name}.schema.ts`), genSchema(name));
  writeFile(
    path.join(moduleDir, "dto", `create-${name}.dto.ts`),
    genCreateDto(name),
  );
  writeFile(
    path.join(moduleDir, "dto", `update-${name}.dto.ts`),
    genUpdateDto(name),
  );
  writeFile(
    path.join(moduleDir, "dto", `search-${name}.dto.ts`),
    genSearchDto(name),
  );
  writeFile(
    path.join(moduleDir, "dto", `${name}-response.dto.ts`),
    genResponseDto(name),
  );
  writeFile(
    path.join(moduleDir, "queries", `${name}.query.ts`),
    genQuery(name),
  );
  writeFile(
    path.join(moduleDir, "mappers", `${name}.mapper.ts`),
    genMapper(name),
  );
  writeFile(
    path.join(moduleDir, "policies", `${name}.policy.ts`),
    genPolicy(name),
  );
  writeFile(path.join(moduleDir, `${name}.repository.ts`), genRepository(name));
  writeFile(path.join(moduleDir, `${name}.service.ts`), genService(name));
  writeFile(path.join(moduleDir, `${name}.controller.ts`), genController(name));
  writeFile(path.join(moduleDir, `${name}.routes.ts`), genRoutes(name));
  registerCrudModule(
    name,
    pluralize(name),
    pascalCase(name),
    camelCase(name),
    permissionConstantName(name),
  );

  // Postman
  updatePostman(name);

  console.log(`\nModule "${name}" generated successfully!`);
  console.log(`\nImportant next steps:`);
  console.log(
    `1. Add model "${pascalCase(name)}" to your schema.prisma file manually.`,
  );
  console.log(
    `2. Run "npx prisma migrate dev --name create-${name}" to update the database schema.`,
  );
  console.log(
    `3. Registry and app registration were updated; review policies and response schemas.\n`,
  );
}

try {
  main();
} catch (error) {
  console.error("Failed to generate module:", error);
  process.exit(1);
}
