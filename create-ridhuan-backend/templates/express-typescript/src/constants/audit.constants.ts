export const AuditAction = {
  REGISTER: "REGISTER",
  LOGIN: "LOGIN",
  REFRESH: "TOKEN_REFRESH",
  LOGOUT: "LOGOUT",
  REPLAY: "REFRESH_REPLAY",
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  RESTORE: "RESTORE",
  ASSIGN_PERMISSIONS: "ASSIGN_PERMISSIONS",
} as const;

export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];
