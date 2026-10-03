export const PERMISSION_GROUPS = {
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
} as const;

type PermissionGroups = typeof PERMISSION_GROUPS;

export type PermissionName = {
  [K in keyof PermissionGroups]: PermissionGroups[K][keyof PermissionGroups[K]];
}[keyof PermissionGroups];

export const USER_PERMISSIONS = PERMISSION_GROUPS.USER;
export const ROLE_PERMISSIONS = PERMISSION_GROUPS.ROLE;
export const PERMISSION_PERMISSIONS = PERMISSION_GROUPS.PERMISSION;
export const UPLOAD_PERMISSIONS = PERMISSION_GROUPS.UPLOAD;
export const NOTIFICATION_PERMISSIONS = PERMISSION_GROUPS.NOTIFICATION;
