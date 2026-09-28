import type { Express } from "express";
import { PermissionController } from "./permission.controller.js";
import { mountEndpoint } from "../../core/http/mount-endpoint.js";
export function registerPermissionRoutes(app: Express): void {
  const controller = new PermissionController();
  mountEndpoint(app, "permission.list", controller.getAll);
  mountEndpoint(app, "permission.get", controller.getById);
  mountEndpoint(app, "permission.create", controller.create);
  mountEndpoint(app, "permission.update", controller.update);
  mountEndpoint(app, "permission.delete", controller.delete);
}
