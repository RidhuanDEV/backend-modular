import { createHash } from "node:crypto";
import { cp, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { objectRecord, readManifest } from "../templates.js";
import type { ProjectAnswers, TemplateManifest } from "../types.js";

export async function verifySnapshot(source: string, manifest: TemplateManifest): Promise<void> {
  if (!("gitignore.template" in manifest.files) || Object.keys(manifest.files).length === 0) throw new Error("Template ignore asset is missing");
  for (const [path, expected] of Object.entries(manifest.files)) {
    const target = resolve(source, path);
    const rel = relative(source, target);
    if (isAbsolute(rel) || rel.startsWith("..") || /(^|[\\/])\.git([\\/]|$)/.test(path)) throw new Error("Unsafe template manifest path");
    const actual = createHash("sha256").update(await readFile(target)).digest("hex");
    if (actual !== expected) throw new Error(`Template checksum mismatch: ${path}. Reinstall the CLI package.`);
  }
}
export async function copyTemplate(source: string, answers: ProjectAnswers): Promise<TemplateManifest> {
  const manifest = await readManifest(source, answers.templateId);
  await verifySnapshot(source, manifest);
  await cp(source, answers.targetDirectory, { recursive: true, errorOnExist: true, force: false });
  const ignorePath = join(answers.targetDirectory, "gitignore.template");
  await writeFile(join(answers.targetDirectory, ".gitignore"), await readFile(ignorePath), { flag: "wx" });
  await unlink(ignorePath);
  return manifest;
}
export async function updateNodePackage(target: string, name: string): Promise<void> {
  for (const file of ["package.json", "package-lock.json"]) {
    const value: unknown = JSON.parse(await readFile(join(target, file), "utf8"));
    const record = objectRecord(value, file);
    record.name = name;
    if (file === "package.json") record.private = true;
    else {
      const packages = objectRecord(record.packages, "lock packages");
      objectRecord(packages[""], "lock root").name = name;
    }
    await writeFile(join(target, file), `${JSON.stringify(record, null, 2)}\n`);
  }
}
export async function transformText(dir: string, transform: (content: string, name: string) => string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await transformText(path, transform);
    else if (entry.isFile() && /\.(go|cs|csproj|slnx|props|json|ya?ml|md|sh|ps1|py|example)$/.test(entry.name) || entry.isFile() && ["go.mod", "Dockerfile", "Makefile"].includes(entry.name)) {
      const text = await readFile(path, "utf8");
      const transformed = transform(text, entry.name);
      if (text !== transformed) await writeFile(path, transformed);
    }
  }
}
