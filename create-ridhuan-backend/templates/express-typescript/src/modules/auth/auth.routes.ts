import type { Express } from "express";
import { AuthController } from "./auth.controller.js";
import { mountEndpoint } from "../../core/http/mount-endpoint.js";
import { loginAccountLimiter } from "../../core/middleware/rate-limit.middleware.js";
export function registerAuthRoutes(app: Express): void {
  const controller = new AuthController();
  mountEndpoint(app, "auth.register", controller.register);
  mountEndpoint(app, "auth.login", controller.login, [loginAccountLimiter]);
  mountEndpoint(app, "auth.refresh", controller.refresh);
  mountEndpoint(app, "auth.logout", controller.logout);
  mountEndpoint(app, "auth.me", controller.me);
}
