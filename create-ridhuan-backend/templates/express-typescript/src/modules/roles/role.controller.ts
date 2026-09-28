import type { Request, Response, NextFunction } from "express";
import { RoleService } from "./role.service.js";
import {
  requireAuthenticatedUser,
  requireRouteParam,
} from "../../core/http/request-context.js";
import { sendSuccess, sendCreated, sendNoContent } from "../../utils/response.js";
import type {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
} from "./role.schema.js";
import { createRoleSchema, updateRoleSchema, assignPermissionsSchema } from "./role.schema.js";

const service = new RoleService();

export class RoleController {
  getAll = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roles = await service.findAll();
      sendSuccess(res, { data: roles });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = requireRouteParam(req, "id");
      const role = await service.findById(id);
      sendSuccess(res, { data: role });
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

      const data: CreateRoleDto = createRoleSchema.parse(req.body);
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

      const data: UpdateRoleDto = updateRoleSchema.parse(req.body);
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

  assignPermissions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const id = requireRouteParam(req, "id");
      const user = requireAuthenticatedUser(req);
      const reqIdStr = req.requestId;

      const data: AssignPermissionsDto = assignPermissionsSchema.parse(req.body);
      const result = await service.assignPermissions(id, data, user, reqIdStr);
      sendSuccess(res, { data: result });
    } catch (error) {
      next(error);
    }
  };
}
