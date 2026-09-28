import type { Express } from "express";
import { UserController } from "./user.controller.js";
import { mountEndpoint } from "../../core/http/mount-endpoint.js";
export function registerUserRoutes(app: Express): void {
  const controller = new UserController();
  mountEndpoint(app, "user.list", controller.getAll);
  mountEndpoint(app, "user.get", controller.getById);
  mountEndpoint(app, "user.create", controller.create);
  mountEndpoint(app, "user.update", controller.update);
  mountEndpoint(app, "user.delete", controller.delete);
}
