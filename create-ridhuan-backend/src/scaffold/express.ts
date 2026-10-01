import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";
import { commonEnv, environmentFile, replaceEnv } from "./env.js";
import { copyTemplate, updateNodePackage } from "./files.js";
export async function scaffoldExpress(source: string, answers: ProjectAnswers): Promise<ScaffoldResult> {
  const env = replaceEnv(await readFile(join(source, environmentFile(answers)), "utf8"), { ...commonEnv(answers), USER_PASSWORD: randomBytes(24).toString("base64url") });
  await copyTemplate(source, answers);
  await updateNodePackage(answers.targetDirectory, answers.packageName);
  await writeFile(join(answers.targetDirectory, ".env"), env, { flag: "wx", mode: 0o600 });
  return { projectDirectory: answers.targetDirectory, templateId: "express-typescript" };
}
