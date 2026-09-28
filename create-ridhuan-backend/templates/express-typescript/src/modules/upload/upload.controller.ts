import type { Request, Response, NextFunction } from "express";
import { UploadService } from "./upload.service.js";
import {
  requireAuthenticatedUser,
  requireRouteParam,
} from "../../core/http/request-context.js";
import { HttpError } from "../../core/errors/http-error.js";
import { sendCreated, sendSuccess } from "../../utils/response.js";

const service = new UploadService();
export class UploadController {
  create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.file) throw HttpError.badRequest("File is required");
      const user = requireAuthenticatedUser(req);
      const data = await service.create(req.file, user.id, req.requestId);
      sendCreated(res, data);
    } catch (err) {
      next(err);
    }
  };
  get = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      requireAuthenticatedUser(req);
      sendSuccess(res, {
        data: await service.get(requireRouteParam(req, "id")),
      });
    } catch (err) {
      next(err);
    }
  };
}
