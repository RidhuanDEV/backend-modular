import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Express } from "express";
import type { AppConfig } from "../../config/env.validation";
import { AuditService } from "../../common/audit/audit.service";
import { CacheService } from "../../common/cache/cache.service";
import { EndpointPolicyService } from "../../common/endpoint/endpoint.registry";
import type { Actor } from "../../common/http/request-context";
import { PrismaService } from "../../platform/database/prisma.service";
import { StorageService } from "../../platform/storage/storage.service";
import type { UploadResponseDto } from "./dto/upload.dto";

function inspect(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) return "image/jpeg";
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return undefined;
}
function mapUpload(value: { id: string; originalName: string; mimeType: string; size: number; storage: string; status: string; createdAt: Date }): UploadResponseDto {
  return { id: value.id, originalName: value.originalName, mimeType: value.mimeType, size: value.size,
    storage: value.storage, status: value.status, createdAt: value.createdAt.toISOString() };
}
@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService<AppConfig, true>, private readonly storage: StorageService,
    private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly policy: EndpointPolicyService, private readonly cache: CacheService) {}
  async create(file: Express.Multer.File | undefined, actor: Actor, requestId?: string): Promise<UploadResponseDto> {
    if (!this.config.get("UPLOAD_ENABLED", { infer: true })) throw new ServiceUnavailableException("Upload is disabled");
    if (!file?.buffer?.length) throw new BadRequestException("Multipart field file is required");
    const max = this.config.get("UPLOAD_MAX_BYTES", { infer: true });
    if (file.buffer.length > max) throw new BadRequestException("File too large");
    const mime = inspect(file.buffer);
    if (!mime || mime !== file.mimetype || !this.config.get("UPLOAD_ALLOWED_MIME", { infer: true }).includes(mime)) {
      throw new BadRequestException("File signature or MIME type is not allowed");
    }
    const stored = await this.storage.put(file.buffer, mime);
    try {
      const value = await this.audit.transact(async (tx) => {
        const next = await tx.storedFile.create({ data: { storage: stored.storage, objectKey: stored.key,
          originalName: file.originalname.slice(0, 255), mimeType: mime, size: file.buffer.length, uploaderId: actor.id } });
        return [next, { endpointId: "upload.create", policy: this.policy.for("upload.create"), actor,
          behavior: "created", module: "upload", entityId: next.id,
          after: { id: next.id, originalName: next.originalName, mimeType: mime, size: next.size },
          ...(requestId ? { requestId } : {}) }] as const;
      });
      return mapUpload(value);
    } catch (error) {
      await this.storage.delete(stored.key, stored.storage).catch(() => undefined);
      throw error;
    }
  }
  async get(id: string, actor: Actor): Promise<UploadResponseDto> {
    const key = `uploads:get:${actor.id}:${id}`;
    if (this.policy.for("upload.get").cache === "read") {
      const cached = await this.cache.get<UploadResponseDto>(key); if (cached) return cached;
    }
    const value = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!value) throw new NotFoundException("Upload not found");
    const result = mapUpload(value);
    if (this.policy.for("upload.get").cache === "read") await this.cache.set(key, result);
    return result;
  }
}
