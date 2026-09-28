import swaggerUi from "swagger-ui-express";
import type { Express, RequestHandler } from "express";
import { mountEndpoint } from "../core/http/mount-endpoint.js";
import { activeDocModules, generateOpenApi } from "./openapi.js";
import { rateLimiter } from "../core/middleware/rate-limit.middleware.js";
import { HttpError } from "../core/errors/http-error.js";

export function setupSwagger(app: Express): void {
  const spec = generateOpenApi();
  mountEndpoint(app, "docs.spec", (_req, res) => {
    res.json(spec);
  });
  mountEndpoint(app, "docs.moduleSpec", (req, res) => {
    const moduleName = req.params["module"];
    if (
      typeof moduleName !== "string" ||
      !activeDocModules().includes(moduleName)
    ) {
      throw HttpError.notFound("Module not found");
    }
    res.json(generateOpenApi(moduleName));
  });
  mountEndpoint(
    app,
    "docs.ui",
    swaggerUi.setup(undefined, {
      swaggerOptions: {
        urls: [
          { url: "/docs/openapi.json", name: "All modules" },
          ...activeDocModules().map((moduleName) => ({
            url: `/docs/specs/${moduleName}.json`,
            name: moduleName,
          })),
        ],
      },
    }),
  );
  app.use(
    "/docs",
    rateLimiter("public"),
    ...(swaggerUi.serve as RequestHandler[]),
  );
}
