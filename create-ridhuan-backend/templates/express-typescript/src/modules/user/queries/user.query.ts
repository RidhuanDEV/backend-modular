import type { QueryBuilderConfig } from "../../../core/database/query-builder.js";
import type { UserResponseDto } from "../dto/user-response.dto.js";

/**
 * Query builder config for User.
 *
 * Use Prisma model field names here (camelCase).
 *
 * searchFields:    Model fields searched with `contains` when ?search= is provided.
 * sortableFields:  Allowlist of model fields valid for ?sortBy=. Any field not in
 *                  this list silently falls back to createdAt.
 * filters:         Maps query-param key to model field + Prisma operator.
 * defaultIncludes: Eager-loaded relations to prevent N+1 queries.
 */
export const userQueryConfig: QueryBuilderConfig = {
  searchFields: ["email"],
  sortableFields: ["createdAt", "updatedAt", "email"],
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

/** Response fields a client may request with ?fields=. */
export const userSelectableFields: readonly (keyof UserResponseDto)[] = [
  "id",
  "email",
  "roleId",
];
