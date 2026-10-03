import "reflect-metadata";
import { HttpException, Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { ModulesContainer } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import type { Express } from "express";
import type { NextFunction, Response } from "express";
import { AppModule } from "./app.module";
import {
  verifyOpenApi,
  verifyRegisteredControllers,
} from "./common/endpoint/registry-verifier";
import { requestContext } from "./common/http/request-context";
import { accessLog } from "./common/http/access-log.middleware";
import type { AppConfig } from "./config/env.validation";
import { DocsService } from "./modules/docs/docs.service";
import { RateLimitService } from "./common/rate-limit/rate-limit.service";
import type { ApiRequest } from "./common/http/request-context";

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set("trust proxy", config.get("TRUST_PROXY_HOPS", { infer: true }));
  app.use(helmet());
  app.use(requestContext);
  app.use(accessLog);
  app.enableCors({
    origin: config.get("CORS_ORIGINS", { infer: true }),
    credentials: false,
    exposedHeaders: ["X-Request-ID", "X-Next-Cursor"],
  });
  const rate = app.get(RateLimitService);
  app.use(
    (request: ApiRequest, response: Response, next: NextFunction): void => {
      const endpointId =
        request.path === "/docs"
          ? "docs.ui"
          : request.path === "/docs/openapi.json"
            ? "docs.spec"
            : undefined;
      if (!endpointId) {
        next();
        return;
      }
      request.endpointId = endpointId;
      const address = request.ip || request.socket.remoteAddress || "unknown";
      void rate.consume("public", address).then(
        () => next(),
        (error: unknown) => {
          const status =
            error instanceof HttpException ? error.getStatus() : 500;
          response.status(status).json({
            success: false,
            message:
              status === 429 ? "Rate limit exceeded" : "Internal server error",
            errors: [],
          });
        },
      );
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Modular NestJS Backend")
      .setDescription("NestJS production template API")
      .setVersion("1.0.0")
      .addBearerAuth()
      .build(),
  );
  doc.paths["/docs"] = {
    get: {
      operationId: "docs.ui",
      tags: ["docs"],
      summary: "API documentation",
      responses: { "200": { description: "Swagger UI HTML" } },
    },
  };
  doc.paths["/docs/openapi.json"] = {
    get: {
      operationId: "docs.spec",
      tags: ["docs"],
      summary: "Full OpenAPI specification",
      responses: { "200": { description: "OpenAPI JSON" } },
    },
  };
  verifyOpenApi(doc);
  app.get(DocsService).setDocument(doc);
  SwaggerModule.setup("docs", app, doc, {
    jsonDocumentUrl: "/docs/openapi.json",
  });
  await app.init();
  verifyRegisteredControllers(app.get(ModulesContainer));
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  await app.listen(config.get("PORT", { infer: true }), "0.0.0.0");
  Logger.log(
    `Listening on port ${config.get("PORT", { infer: true })}`,
    "Bootstrap",
  );
}
if (require.main === module)
  bootstrap().catch((error: unknown) => {
    Logger.error(error, "Bootstrap");
    process.exitCode = 1;
  });
