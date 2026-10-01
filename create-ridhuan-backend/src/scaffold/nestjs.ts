import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";
import { commonEnv, environmentFile, replaceEnv } from "./env.js";
import { copyTemplate, updateNodePackage } from "./files.js";
export async function scaffoldNestjs(source: string, answers: ProjectAnswers): Promise<ScaffoldResult> {
  const env = replaceEnv(await readFile(join(source, environmentFile(answers)), "utf8"), { ...commonEnv(answers), REDIS_URL_DOCKER: "redis://redis:6379", REDIS_NAMESPACE: answers.deploymentName });
  await copyTemplate(source, answers);
  await updateNodePackage(answers.targetDirectory, answers.packageName);
  await writeFile(join(answers.targetDirectory, ".env"), env, { flag: "wx", mode: 0o600 });
  return { projectDirectory: answers.targetDirectory, templateId: "nestjs" };
}
