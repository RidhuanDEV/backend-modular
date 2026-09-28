import type { Express } from "express";
import { RoleController } from "./role.controller.js";
import { mountEndpoint } from "../../core/http/mount-endpoint.js";
export function registerRoleRoutes(app: Express): void {
  const controller = new RoleController();
  mountEndpoint(app, "role.list", controller.getAll);
  mountEndpoint(app, "role.get", controller.getById);
  mountEndpoint(app, "role.create", controller.create);
  mountEndpoint(app, "role.update", controller.update);
  mountEndpoint(app, "role.delete", controller.delete);
  mountEndpoint(app, "role.assignPermissions", controller.assignPermissions);
}
