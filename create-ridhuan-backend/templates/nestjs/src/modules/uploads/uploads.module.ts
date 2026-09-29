import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import type { AppConfig } from "../../config/env.validation";
import { StorageService } from "../../platform/storage/storage.service";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";
@Module({
  imports: [MulterModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService<AppConfig, true>) => ({
      limits: { fileSize: config.get("UPLOAD_MAX_BYTES", { infer: true }), files: 1 },
    }),
  })],
  controllers: [UploadsController],
  providers: [UploadsService, StorageService],
})
export class UploadsModule {}
