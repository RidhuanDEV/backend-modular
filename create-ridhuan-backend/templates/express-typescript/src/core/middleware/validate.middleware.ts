import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodType } from "zod";
import { HttpError } from "../errors/http-error.js";

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: ValidationSchemas) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }

      if (schemas.query) {
        const parsed = await schemas.query.parseAsync(req.query);
        // Express 5 exposes req.query as a prototype getter that re-parses the URL on
        // every access, so mutating it is lost. Shadow it on the request instead.
        Object.defineProperty(req, "query", {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      if (schemas.params) {
        const parsed = await schemas.params.parseAsync(req.params);
        Object.assign(req.params, parsed);
      }

      next();
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        next(HttpError.badRequest("Validation failed", err.issues));
      } else {
        next(err);
      }
    }
  };
}
