import { parseInstant } from "../time/time.js";
import { databaseProvider } from "../../config/database-adapter.js";

// ─── Public Interfaces ───────────────────────────────────────────────────────

/**
 * Every generated SearchDto must satisfy this interface.
 * The generator enforces these fields via the searchSchema template.
 */
export interface BaseSearchQuery {
  page: number;
  limit: number;
  sortBy?: string | undefined;
  orderBy?: "asc" | "desc" | undefined;
  search?: string | undefined;
  /** Comma-separated list of response/model field names to include in list responses. */
  fields?: string | undefined;
}

export type PrismaOperator =
  | "equals"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not";

export type FilterType = "string" | "number" | "boolean" | "enum" | "date";

export interface FilterConfig {
  /** Prisma model field name (camelCase). */
  column: string;
  type: FilterType;
  /**
   * Prisma operator. Defaults to "equals".
   * Common values: "gte", "lte", "contains", "in", "not"
   */
  operator?: PrismaOperator;
}

export interface QueryBuilderConfig {
  /**
   * Prisma model field names to search with `contains` when `search` is provided.
   * Example: ['name', 'description']
   */
  searchFields?: string[];

  /**
   * Map from query-param key → model field filter definition.
   * Example: { yearMin: { column: 'year', type: 'number', operator: 'gte' } }
   */
  filters?: Record<string, FilterConfig>;

  /**
   * Allowlist of Prisma model field names that are valid `sortBy` targets.
   * If defined and the requested sort field is not in this list,
   * the sort silently falls back to 'createdAt'.
   */
  sortableFields?: string[];

  /**
   * Allowlist of response/model fields that may be returned via the ?fields= param.
   * Only fields present in this list are ever selected.
   */
  selectableFields?: string[];

  /**
   * Default Prisma includes (eager-loaded relations).
   * Example: { role: true } or { role: { include: { permissions: true } } }
   */
  defaultIncludes?: Record<string, unknown>;
}

// ─── Result Interfaces ───────────────────────────────────────────────────────

export interface PrismaFindOptions {
  where: Record<string, unknown>;
  skip: number;
  take: number;
  orderBy: Record<string, string>[];
  select?: Record<string, boolean>;
  include?: Record<string, unknown>;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Converts a parsed SearchDto into Prisma-compatible query options.
 *
 * @param query  The parsed search DTO (must extend BaseSearchQuery).
 * @param config Query builder configuration for this module.
 */
export function buildFindOptions<Q extends BaseSearchQuery>(
  query: Q,
  config: QueryBuilderConfig = {},
): PrismaFindOptions {
  const { page, limit, sortBy, search, fields, orderBy } = query;

  // ── Pagination ──────────────────────────────────────────────────────────
  const skip = (page - 1) * limit;

  // ── Sorting with allowlist ───────────────────────────────────────────────
  const rawSortField = sortBy ? sortBy : "createdAt";
  const sortField =
    config.sortableFields && config.sortableFields.length > 0
      ? config.sortableFields.includes(rawSortField)
        ? rawSortField
        : "createdAt"
      : rawSortField;
  const sortDir = orderBy === "desc" ? "desc" : "asc";
  const orderByClause: Record<string, string>[] = [{ [sortField]: sortDir }];

  // ── WHERE clause ─────────────────────────────────────────────────────────
  const where: Record<string, unknown> = {};
  const orConditions: Record<string, unknown>[] = [];

  // Full-text search across configured fields
  if (search != null && search.length > 0 && config.searchFields?.length) {
    for (const col of config.searchFields) {
      orConditions.push({ [col]: databaseProvider() === "postgresql"
        ? { contains: search, mode: "insensitive" }
        : { contains: search.toLowerCase() } });
    }
  }

  if (orConditions.length > 0) {
    where["OR"] = orConditions;
  }

  // Typed filter fields
  if (config.filters) {
    const queryRecord = query as Record<string, unknown>;

    for (const [queryKey, filterCfg] of Object.entries(config.filters)) {
      const raw = queryRecord[queryKey];
      if (raw === undefined || raw === null) continue;

      const coerced = coerceFilterValue(raw, filterCfg.type);
      const op = filterCfg.operator ?? "equals";

      if (op === "equals") {
        where[filterCfg.column] = coerced;
      } else {
        const existing = where[filterCfg.column];
        if (
          existing !== undefined &&
          typeof existing === "object" &&
          existing !== null
        ) {
          (existing as Record<string, unknown>)[op] = coerced;
        } else {
          where[filterCfg.column] = { [op]: coerced };
        }
      }
    }
  }

  // ── Field selection ───────────────────────────────────────────────────
  let select: Record<string, boolean> | undefined;
  if (fields && config.selectableFields?.length) {
    const requested = Array.from(
      new Set(
        fields
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean),
      ),
    );
    const filtered = requested.filter((f) =>
      config.selectableFields!.includes(f),
    );
    if (filtered.length > 0) {
      select = {};
      for (const f of filtered) {
        select[f] = true;
      }
    }
  }

  const result: PrismaFindOptions = {
    where,
    skip,
    take: limit,
    orderBy: orderByClause,
  };

  if (select) {
    result.select = select;
  }

  if (config.defaultIncludes && Object.keys(config.defaultIncludes).length > 0) {
    result.include = config.defaultIncludes;
  }

  return result;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function coerceFilterValue(value: unknown, type: FilterType): unknown {
  switch (type) {
    case "number":
      return Number(value);
    case "boolean":
      return value === "true" || value === true || value === "1" || value === 1;
    case "date":
      return parseInstant(String(value));
    default:
      return value;
  }
}
