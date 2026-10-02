import { observed } from "../../core/observability/telemetry.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";

function s3Connection(): { client: S3Client; bucket: string } {
  const {
    S3_REGION: region,
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: accessKeyId,
    S3_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (!region || !bucket || !accessKeyId || !secretAccessKey)
    throw new Error("S3 storage configuration is incomplete");
  const client = new S3Client({
    region,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}
function filePath(key: string): string {
  return path.join(path.resolve(env.UPLOAD_LOCAL_DIR), key);
}

export class StorageService {
  async *listObjects(): AsyncGenerator<{ key: string; modifiedAt: Date }> {
    if (env.UPLOAD_STORAGE === "local") {
      const directory = path.resolve(env.UPLOAD_LOCAL_DIR);
      await mkdir(directory, { recursive: true });
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const details = await stat(filePath(entry.name)).catch(
          (error: unknown) => {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
              return undefined;
            throw error;
          },
        );
        if (!details) continue;
        yield { key: entry.name, modifiedAt: details.mtime };
      }
      return;
    }
    const { client, bucket } = s3Connection();
    try {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        );
        for (const object of page.Contents ?? []) {
          if (object.Key && object.LastModified)
            yield { key: object.Key, modifiedAt: object.LastModified };
        }
        token = page.NextContinuationToken;
      } while (token);
    } finally {
      client.destroy();
    }
  }

  async put(
    body: Buffer,
    mimeType: string,
  ): Promise<{ key: string; storage: "local" | "s3" }> {
    return observed("storage", async () => {
      const key = randomUUID();
      if (env.UPLOAD_STORAGE === "local") {
        await mkdir(path.resolve(env.UPLOAD_LOCAL_DIR), { recursive: true });
        await writeFile(filePath(key), body, { flag: "wx", mode: 0o600 });
        return { key, storage: "local" };
      }
      const { client, bucket } = s3Connection();
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: mimeType,
          }),
        );
      } finally {
        client.destroy();
      }
      return { key, storage: "s3" };
    });
  }
  async remove(key: string, storage: "local" | "s3"): Promise<void> {
    return observed("storage", async () => {
      if (storage === "local") {
        await unlink(filePath(key)).catch((error: unknown) => {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          )
            throw error;
        });
        return;
      }
      const { client, bucket } = s3Connection();
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
      } finally {
        client.destroy();
      }
    });
  }
}
export const storageService = new StorageService();
