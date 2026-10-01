import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";
import { commonEnv, environmentFile, replaceEnv } from "./env.js";
import { copyTemplate } from "./files.js";

export async function scaffoldFastapi(source: string, answers: ProjectAnswers): Promise<ScaffoldResult> {
  const env = replaceEnv(await readFile(join(source, environmentFile(answers)), "utf8"), {
    ...commonEnv(answers), REDIS_URL_DOCKER: "redis://redis:6379",
  });
  await copyTemplate(source, answers);
  const identity = "modular-fastapi";
  for (const file of ["pyproject.toml", "uv.lock"]) {
    const path = join(answers.targetDirectory, file);
    const contents = await readFile(path, "utf8");
    if (!contents.includes(`name = "${identity}"`)) throw new Error(`Python project identity absent: ${file}`);
    await writeFile(path, contents.replaceAll(`name = "${identity}"`, `name = "${answers.packageName}"`));
  }
  await writeFile(join(answers.targetDirectory, ".env"), env, { flag: "wx", mode: 0o600 });
  return { projectDirectory: answers.targetDirectory, templateId: "fastapi" };
}
