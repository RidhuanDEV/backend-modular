import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { auditService } from "../../core/audit/audit.service.js";
import { cacheService } from "../../core/cache/cache.service.js";
import { fileCacheSchema } from "../../core/cache/cache-schemas.js";
import { HttpError } from "../../core/errors/http-error.js";
import { AuditAction } from "../../constants/audit.constants.js";
import { UPLOAD_MODULE } from "../../constants/modules.constants.js";
import { storageService } from "./storage.service.js";
import { logger } from "../../core/logger/logger.js";

function validSignature(body: Buffer, mime: string): boolean {
  if (mime === "image/png")
    return body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return body.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === "application/pdf")
    return body.subarray(0, 5).toString() === "%PDF-";
  return false;
}
export interface FileMetadata {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}
export class UploadService {
  async create(
    file: Express.Multer.File,
    uploaderId: string,
    requestId?: string,
  ): Promise<FileMetadata> {
    if (
      !env.UPLOAD_ALLOWED_MIME.split(",").includes(file.mimetype) ||
      !validSignature(file.buffer, file.mimetype)
    )
      throw HttpError.badRequest("Unsupported file type");
    const object = await storageService.put(file.buffer, file.mimetype);
    try {
      const stored = await prisma.$transaction(async (tx) => {
        const record = await tx.storedFile.create({
          data: {
            storage: object.storage,
            objectKey: object.key,
            originalName:
              file.originalname.split(/[\\/]/).pop()?.slice(0, 255) ?? "file",
            mimeType: file.mimetype,
            size: file.size,
            uploaderId,
          },
        });
        await auditService.persist({
          action: AuditAction.CREATE,
          module: UPLOAD_MODULE,
          entityId: record.id,
          userId: uploaderId,
          after: {
            id: record.id,
            mimeType: record.mimeType,
            size: record.size,
          },
          requestId,
          trx: tx,
        });
        return record;
      });
      return this.toMetadata(stored);
    } catch (err) {
      try {
        await storageService.remove(object.key, object.storage);
      } catch (cleanupError) {
        logger.error(
          { cleanupError, key: object.key },
          "Orphaned upload requires cleanup",
        );
      }
      throw err;
    }
  }
  async get(id: string): Promise<FileMetadata> {
    const key = `file:${id}`;
    const cached = await cacheService.get(key, fileCacheSchema);
    if (cached) return cached;
    const stored = await prisma.storedFile.findUnique({ where: { id } });
    if (!stored) throw HttpError.notFound("File not found");
    const result = this.toMetadata(stored);
    await cacheService.set(key, result, 60);
    return result;
  }
  private toMetadata(record: {
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    createdAt: Date;
  }): FileMetadata {
    return {
      id: record.id,
      originalName: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
