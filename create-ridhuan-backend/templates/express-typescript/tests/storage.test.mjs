import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL =
  process.env.DB_PROVIDER === "mysql"
    ? "mysql://test:test@127.0.0.1:3306/test"
    : "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test_secret_at_least_32_characters_long";
process.env.UPLOAD_STORAGE = "local";
process.env.CACHE_ENABLED = "false";
process.env.RATE_LIMIT_STORE = "memory";

test("local upload adapter writes and removes an object", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "starter-upload-"));
  process.env.UPLOAD_LOCAL_DIR = directory;
  const { storageService } =
    await import("../dist/modules/upload/storage.service.js");
  try {
    const bytes = Buffer.from("file content");
    const object = await storageService.put(bytes, "text/plain");
    assert.equal(object.storage, "local");
    assert.deepEqual(await readFile(path.join(directory, object.key)), bytes);
    await storageService.remove(object.key, "local");
    await assert.rejects(readFile(path.join(directory, object.key)));
  } finally {
    await rmdir(directory);
  }
});
