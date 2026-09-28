import { prisma, disconnectPrisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { storageService } from "../modules/upload/storage.service.js";
import { logger } from "../core/logger/logger.js";

const uuidKey =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const apply = process.argv.includes("--apply");
const cutoff = Date.now() - env.UPLOAD_ORPHAN_GRACE_HOURS * 60 * 60 * 1000;
let candidates = 0;
let deleted = 0;

try {
  for await (const object of storageService.listObjects()) {
    if (!uuidKey.test(object.key) || object.modifiedAt.getTime() >= cutoff)
      continue;
    const row = await prisma.storedFile.findUnique({
      where: { objectKey: object.key },
      select: { id: true },
    });
    if (row) continue;
    candidates++;
    logger.warn(
      { key: object.key, modifiedAt: object.modifiedAt },
      "Orphaned upload",
    );
    if (apply) {
      await storageService.remove(object.key, env.UPLOAD_STORAGE);
      deleted++;
    }
  }
  logger.info({ candidates, deleted, apply }, "Upload cleanup complete");
} finally {
  await disconnectPrisma();
}
