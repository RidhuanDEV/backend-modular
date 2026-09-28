import type { UserWithRole } from "../user.repository.js";
import type {
  UserResponseDto,
  UserResponseProjection,
} from "../dto/user-response.dto.js";

/**
 * Maps a Prisma User (with role+permissions) to UserResponseDto.
 *
 * This function is the **API contract boundary**: changes to DB column names
 * should be handled here, never in the controller or service, so the
 * response shape stays stable for API consumers.
 *
 * Dates are serialised to ISO 8601 strings to match JSON output exactly.
 */
export function toUserResponse(model: UserWithRole): UserResponseDto {
  const roleData = model.role
    ? {
        id: model.role.id,
        name: model.role.name,
        permissions: model.role.permissions.map((rp) => ({
          id: rp.permission.id,
          name: rp.permission.name,
        })),
      }
    : undefined;

  return {
    id: model.id,
    email: model.email,
    roleId: model.roleId,
    ...(roleData !== undefined ? { role: roleData } : {}),
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}

export function toUserResponseList(models: UserWithRole[]): UserResponseProjection[] {
  return models.map((model) => {
    const roleData = model.role
      ? {
          id: model.role.id,
          name: model.role.name,
          permissions: model.role.permissions.map((rp) => ({
            id: rp.permission.id,
            name: rp.permission.name,
          })),
        }
      : undefined;

    return {
      id: model.id,
      email: model.email,
      roleId: model.roleId,
      ...(roleData !== undefined ? { role: roleData } : {}),
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  });
}
