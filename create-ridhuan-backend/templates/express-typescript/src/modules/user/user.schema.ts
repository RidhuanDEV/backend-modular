import { z } from "zod";
import { emailField, newPasswordField } from "../auth/auth.schema.js";

export const createUserSchema = z.object({
  email: emailField(),
  password: newPasswordField(),
  roleId: z.string().uuid("roleId must be a valid UUID"),
});

export const updateUserSchema = z.object({
  email: emailField().optional(),
  roleId: z.string().uuid("roleId must be a valid UUID").optional(),
});

export const userIdSchema = z.object({
  id: z.uuid(),
});

export const searchUserSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.string().optional(),
  orderBy: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
  fields: z.string().optional(),
});
