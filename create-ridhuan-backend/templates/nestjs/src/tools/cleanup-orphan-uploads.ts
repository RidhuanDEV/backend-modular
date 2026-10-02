import "../config/load-env";
import { readdir, lstat, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  createDatabaseAdapter,
  databaseProvider,
} from "../platform/database/database-adapter";
import { PrismaClient } from "../generated/prisma/client";

import { cleanupRows, operationsConfig } from "../platform/jobs/operations";
import {
  shutdownTelemetry,
  cleanupItems,
  observed,
} from "../common/observability/telemetry";
const KEY = /^[0-9a-f-]{36}$/;
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const apply = process.argv.includes("--apply");
  if (apply && process.argv.includes("--dry-run"))
    throw new Error("Use --apply or --dry-run");
  const hours = Number(process.env.UPLOAD_ORPHAN_GRACE_HOURS ?? "24");
  if (!Number.isInteger(hours) || hours < 1)
    throw new Error("UPLOAD_ORPHAN_GRACE_HOURS must be positive");
  const cutoff = Date.now() - hours * 3600000;
  const prisma = new PrismaClient({
    adapter: createDatabaseAdapter(url, databaseProvider()),
  });
  try {
    await prisma.$connect();
    await cleanupRows(prisma, apply, (message) =>
      process.stdout.write(message + "\n"),
    );
    let candidates = 0;
    const referenced = async (key: string): Promise<boolean> =>
      Boolean(
        await prisma.storedFile.findUnique({
          where: { objectKey: key },
          select: { id: true },
        }),
      );
    if (process.env.UPLOAD_STORAGE === "s3") {
      const bucket = process.env.S3_BUCKET;
      if (
        !bucket ||
        !process.env.S3_REGION ||
        !process.env.S3_ACCESS_KEY_ID ||
        !process.env.S3_SECRET_ACCESS_KEY
      )
        throw new Error("S3 configuration is incomplete");
      const s3 = new S3Client({
        region: process.env.S3_REGION,
        ...(process.env.S3_ENDPOINT
          ? { endpoint: process.env.S3_ENDPOINT }
          : {}),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      });
      let continuationToken: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            ...(continuationToken
              ? { ContinuationToken: continuationToken }
              : {}),
          }),
        );
        for (const object of page.Contents ?? []) {
          if (candidates >= operationsConfig().batchSize) break;
          const key = object.Key;
          if (
            !key ||
            !KEY.test(key) ||
            (await referenced(key)) ||
            !object.LastModified ||
            object.LastModified.getTime() >= cutoff
          )
            continue;
          candidates++;
          process.stdout.write(`${apply ? "DELETE" : "ORPHAN"} s3 ${key}\n`);
          if (apply && !(await referenced(key))) {
            await observed("storage", () =>
              s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
            );
            cleanupItems("uploads", 1, true);
          } else if (!apply) cleanupItems("uploads", 1, false);
        }
        continuationToken = page.NextContinuationToken;
      } while (continuationToken && candidates < operationsConfig().batchSize);
      s3.destroy();
    } else {
      const root = resolve(process.env.UPLOAD_LOCAL_DIR ?? "./uploads");
      const rootStat = await lstat(root).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return undefined;
        throw error;
      });
      if (!rootStat) return;
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
        throw new Error("Unsafe upload directory");
      for (const name of await readdir(root)) {
        if (candidates >= operationsConfig().batchSize) break;
        if (!KEY.test(name) || (await referenced(name))) continue;
        const path = resolve(root, name);
        if (!path.startsWith(`${root}${sep}`))
          throw new Error("Unsafe upload path");
        const entry = await lstat(path).catch((error: unknown) => {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return undefined;
          throw error;
        });
        if (!entry) continue;
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          entry.mtimeMs >= cutoff
        )
          continue;
        candidates++;
        process.stdout.write(
          `${apply ? "DELETE" : "ORPHAN"} local ${join(root, name)}\n`,
        );
        if (apply && !(await referenced(name))) {
          const deleted = await observed("storage", async () => {
            try {
              await unlink(path);
              return true;
            } catch (error) {
              if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              )
                return false;
              throw error;
            }
          });
          if (deleted) cleanupItems("uploads", 1, true);
        } else if (!apply) cleanupItems("uploads", 1, false);
      }
    }
  } finally {
    await prisma.$disconnect();
    await shutdownTelemetry();
  }
}
main().catch(() => {
  process.stderr.write(
    "Cleanup failed; check configuration and dependency availability\n",
  );
  process.exitCode = 1;
});
