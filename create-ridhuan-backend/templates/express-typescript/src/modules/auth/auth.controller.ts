import type { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service.js";
import { requireAuthenticatedUser } from "../../core/http/request-context.js";
import { sendSuccess, sendCreated, sendNoContent } from "../../utils/response.js";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
} from "./auth.schema.js";

const service = new AuthService();

export class AuthController {
  register = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = await service.register(registerSchema.parse(req.body), req.requestId);
      sendCreated(res, user);
    } catch (err) {
      next(err);
    }
  };

  login = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await service.login(loginSchema.parse(req.body), req.requestId);
      sendSuccess(res, { data: result });
    } catch (err) {
      next(err);
    }
  };

  refresh = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = refreshSchema.parse(req.body);
      const result = await service.refresh(body.refreshToken);
      sendSuccess(res, { data: result });
    } catch (err) {
      next(err);
    }
  };

  logout = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = logoutSchema.parse(req.body);
      await service.logout(body.refreshToken);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  };

  me = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const authUser = requireAuthenticatedUser(req);
      const user = await service.me(authUser.id);
      sendSuccess(res, { data: user });
    } catch (err) {
      next(err);
    }
  };
}
