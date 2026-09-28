import type { Request, Response, NextFunction } from "express";
import { PermissionService } from "./permission.service.js";
import {
  requireAuthenticatedUser,
  requireRouteParam,
} from "../../core/http/request-context.js";
import { sendSuccess, sendCreated, sendNoContent } from "../../utils/response.js";
import type {
  CreatePermissionDto,
  UpdatePermissionDto,
} from "./permission.schema.js";
import { createPermissionSchema, updatePermissionSchema } from "./permission.schema.js";

const service = new PermissionService();

export class PermissionController {
  getAll = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const permissions = await service.findAll();
      sendSuccess(res, { data: permissions });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = requireRouteParam(req, "id");
      const permission = await service.findById(id);
      sendSuccess(res, { data: permission });
    } catch (error) {
      next(error);
    }
  };

  create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = requireAuthenticatedUser(req);
      const reqIdStr = req.requestId;

      const data: CreatePermissionDto = createPermissionSchema.parse(req.body);
      const result = await service.create(data, user, reqIdStr);
      sendCreated(res, result);
    } catch (error) {
      next(error);
    }
  };

  update = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = requireRouteParam(req, "id");
      const user = requireAuthenticatedUser(req);
      const reqIdStr = req.requestId;

      const data: UpdatePermissionDto = updatePermissionSchema.parse(req.body);
      const result = await service.update(id, data, user, reqIdStr);
      sendSuccess(res, { data: result });
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = requireRouteParam(req, "id");
      const user = requireAuthenticatedUser(req);
      const reqIdStr = req.requestId;

      await service.delete(id, user, reqIdStr);
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  };
}
