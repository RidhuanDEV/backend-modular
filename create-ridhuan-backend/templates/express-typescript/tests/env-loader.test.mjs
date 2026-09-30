import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvironment } from "../dist/config/load-env.js";

test("quoted credentials round trip and injected environment wins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "env-loader-"));
  const key = "CLI_ENV_ROUNDTRIP_TEST";
  const original = process.env[key];
  try {
    delete process.env[key];
    const path = join(directory, ".env");
    await writeFile(path, `${key}='hash#$cash "quoted" apostrophe\\' back\\slash Unicode-æ—¥æœ¬'\n`);
    loadEnvironment(path);
    assert.equal(process.env[key], `hash#$cash "quoted" apostrophe' back\\slash Unicode-æ—¥æœ¬`);
    process.env[key] = "injected";
    loadEnvironment(path);
    assert.equal(process.env[key], "injected");
  } finally {
    if (original === undefined) delete process.env[key]; else process.env[key] = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test("backslash and escaped dollar edges survive the dotenv loader", async () => {
 const dir = await mkdtemp(join(tmpdir(), "env-edge-")); const key = "CLI_ENV_EDGE_TEST", prior = process.env[key];
 try { for (const value of ['trailing\\', "slash\\'quote", 'x\\$HOME $$x 日本']) {
  delete process.env[key]; const path = join(dir,'.env');
  await writeFile(path, key+'='+JSON.stringify(value).replaceAll('$','\\$')+'\n'); loadEnvironment(path);
  assert.equal(process.env[key], value, "Escaped credential changed");
 }} finally { if(prior===undefined)delete process.env[key];else process.env[key]=prior;await rm(dir,{recursive:true,force:true}); }
});
