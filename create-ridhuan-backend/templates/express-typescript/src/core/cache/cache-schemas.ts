import { z } from "zod";

const instant = z.iso.datetime({ offset: true });
export const userCacheSchema = z.object({
  id: z.string(),
  email: z.email(),
  roleId: z.string(),
  role: z
    .object({
      id: z.string(),
      name: z.string(),
      permissions: z
        .array(z.object({ id: z.string(), name: z.string() }))
        .optional(),
    })
    .optional(),
  createdAt: instant,
  updatedAt: instant,
});
export const paginationCacheSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});
export const userListCacheSchema = z.object({
  data: z.array(userCacheSchema),
  meta: paginationCacheSchema,
});
export const permissionCacheSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: instant,
  updatedAt: instant,
});
export const roleCacheSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: instant,
  updatedAt: instant,
  permissions: z.array(
    z.object({
      roleId: z.string(),
      permissionId: z.string(),
      permission: permissionCacheSchema,
    }),
  ),
});
export const fileCacheSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  createdAt: instant,
});
