import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, lstat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../config/env.validation";

export interface StoredObject { key: string; storage: "local" | "s3"; }

@Injectable()
export class StorageService {
  private readonly s3?: S3Client;
  constructor(private readonly config: ConfigService<AppConfig, true>) {
    if (config.get("UPLOAD_STORAGE", { infer: true }) === "s3" && config.get("UPLOAD_ENABLED", { infer: true })) {
      this.s3 = new S3Client({ region: config.get("S3_REGION", { infer: true }) ?? "us-east-1",
        ...(config.get("S3_ENDPOINT", { infer: true }) ? { endpoint: config.get("S3_ENDPOINT", { infer: true }) } : {}),
        forcePathStyle: config.get("S3_FORCE_PATH_STYLE", { infer: true }),
        credentials: { accessKeyId: config.get("S3_ACCESS_KEY_ID", { infer: true }) ?? "",
          secretAccessKey: config.get("S3_SECRET_ACCESS_KEY", { infer: true }) ?? "" },
      });
    }
  }
  async put(buffer: Buffer, mimeType: string): Promise<StoredObject> {
    const key = randomUUID();
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.config.get("S3_BUCKET", { infer: true }), Key: key,
        Body: buffer, ContentType: mimeType }));
      return { key, storage: "s3" };
    }
    const root = resolve(this.config.get("UPLOAD_LOCAL_DIR", { infer: true }));
    await mkdir(root, { recursive: true });
    const rootStat = await lstat(root);
    if (rootStat.isSymbolicLink()) throw new BadRequestException("Upload directory cannot be a symlink");
    await writeFile(join(root, key), buffer, { flag: "wx", mode: 0o600 });
    return { key, storage: "local" };
  }
  async delete(key: string, storage: "local" | "s3"): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new BadRequestException("Invalid object key");
    if (storage === "s3") {
      if (!this.s3) throw new Error("S3 storage unavailable");
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.get("S3_BUCKET", { infer: true }), Key: key }));
      return;
    }
    const root = resolve(this.config.get("UPLOAD_LOCAL_DIR", { infer: true }));
    const target = resolve(root, key);
    if (!target.startsWith(`${root}${sep}`)) throw new BadRequestException("Invalid object path");
    await unlink(target);
  }
}
