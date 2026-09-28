import type { QueryBuilderConfig } from "../../../core/database/query-builder.js";

/**
 * Query builder config for User.
 *
 * Use Prisma model field names here (camelCase).
 *
 * searchFields:    Model fields searched with `contains` when ?search= is provided.
 * sortableFields:  Allowlist of model fields valid for ?sortBy=. Any field not in
 *                  this list silently falls back to createdAt.
 * selectableFields: Allowlist for ?fields= field selection. Only these fields
 *                  can be returned, preventing internal/sensitive column leaks.
 * filters:         Maps query-param key to model field + Prisma operator.
 * defaultIncludes: Eager-loaded relations to prevent N+1 queries.
 */
export const userQueryConfig: QueryBuilderConfig = {
  searchFields: [
    "email",
  ],
  sortableFields: [
    "createdAt",
    "updatedAt",
    "email",
  ],
  selectableFields: [
    "id",
    "email",
    "roleId",
  ],
  filters: {},
  defaultIncludes: {
    role: {
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    },
  },
};
