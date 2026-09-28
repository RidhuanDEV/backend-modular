import type { Express } from "express";
import multer from "multer";
import { env } from "../../config/env.js";
import { mountEndpoint } from "../../core/http/mount-endpoint.js";
import { UploadController } from "./upload.controller.js";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 },
});
export function registerUploadRoutes(app: Express): void {
  const controller = new UploadController();
  mountEndpoint(app, "upload.create", controller.create, [
    parser.single("file"),
  ]);
  mountEndpoint(app, "upload.get", controller.get);
}
