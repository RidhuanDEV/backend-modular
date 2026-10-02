import express from "express";
import helmet from "helmet";
import cors from "cors";
import { configureZodLocale } from "./core/validation/zod-error-map.js";
import { requestIdMiddleware } from "./core/middleware/request-id.middleware.js";
import { accessLogMiddleware } from "./core/middleware/access-log.middleware.js";
import { errorMiddleware } from "./core/middleware/error.middleware.js";
import { setupSwagger } from "./docs/swagger.js";
import {
  mountEndpoint,
  assertEndpointCoverage,
} from "./core/http/mount-endpoint.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerUserRoutes } from "./modules/user/user.routes.js";
import { registerRoleRoutes } from "./modules/roles/role.routes.js";
import { registerPermissionRoutes } from "./modules/permissions/permission.routes.js";
import { registerUploadRoutes } from "./modules/upload/upload.routes.js";
import { registerNotificationRoutes } from "./modules/notifications/notification.routes.js";
import { env } from "./config/env.js";
import { sendSuccess } from "./utils/response.js";
import { readinessHandler } from "./core/http/health.js";

// Configure Zod to return Bahasa Indonesia validation messages globally.
configureZodLocale();

const app = express();

app.set("trust proxy", env.TRUST_PROXY_HOPS);
app.use(helmet());
const allowedOrigins = new Set(
  env.CORS_ORIGINS.length
    ? env.CORS_ORIGINS
    : ["http://localhost:5173", "http://localhost:3000"],
);
app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, origin === undefined || allowedOrigins.has(origin)),
    credentials: false,
    exposedHeaders: ["X-Request-ID", "X-Next-Cursor"],
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestIdMiddleware);
app.use(accessLogMiddleware);

setupSwagger(app);

mountEndpoint(app, "health.get", (_req, res) => {
  sendSuccess(res, { data: { status: "ok" } });
});
mountEndpoint(app, "live.get", (_req, res) => {
  sendSuccess(res, { data: { status: "ok" } });
});
mountEndpoint(app, "ready.get", readinessHandler);

registerAuthRoutes(app);
registerUserRoutes(app);
registerRoleRoutes(app);
registerPermissionRoutes(app);
registerUploadRoutes(app);
registerNotificationRoutes(app);
assertEndpointCoverage();

app.use(errorMiddleware);

export { app };
