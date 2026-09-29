import "dotenv/config";
import { readdir, lstat, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const KEY = /^[0-9a-f-]{36}$/;
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const apply = process.argv.includes("--apply");
  const hours = Number(process.env.UPLOAD_ORPHAN_GRACE_HOURS ?? "24");
  if (!Number.isInteger(hours) || hours < 1) throw new Error("UPLOAD_ORPHAN_GRACE_HOURS must be positive");
  const cutoff = Date.now() - hours * 3600000;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await prisma.$connect();
    const stored = await prisma.storedFile.findMany({ select: { objectKey: true } });
    const referenced = new Set(stored.map((item) => item.objectKey));
    if (process.env.UPLOAD_STORAGE === "s3") {
      const bucket = process.env.S3_BUCKET;
      if (!bucket || !process.env.S3_REGION || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new Error("S3 configuration is incomplete");
      const s3 = new S3Client({ region: process.env.S3_REGION, ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
      let continuationToken: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ...(continuationToken ? { ContinuationToken: continuationToken } : {}) }));
        for (const object of page.Contents ?? []) {
          const key = object.Key;
          if (!key || !KEY.test(key) || referenced.has(key) || !object.LastModified || object.LastModified.getTime() >= cutoff) continue;
          process.stdout.write(`${apply ? "DELETE" : "ORPHAN"} s3 ${key}\n`);
          if (apply) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        }
        continuationToken = page.NextContinuationToken;
      } while (continuationToken);
      s3.destroy();
    } else {
      const root = resolve(process.env.UPLOAD_LOCAL_DIR ?? "./uploads");
      const rootStat = await lstat(root);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Unsafe upload directory");
      for (const name of await readdir(root)) {
        if (!KEY.test(name) || referenced.has(name)) continue;
        const path = resolve(root, name);
        if (!path.startsWith(`${root}${sep}`)) throw new Error("Unsafe upload path");
        const entry = await lstat(path);
        if (!entry.isFile() || entry.isSymbolicLink() || entry.mtimeMs >= cutoff) continue;
        process.stdout.write(`${apply ? "DELETE" : "ORPHAN"} local ${join(root, name)}\n`);
        if (apply) await unlink(path);
      }
    }
  } finally { await prisma.$disconnect(); }
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Cleanup failed"}\n`); process.exitCode = 1; });
