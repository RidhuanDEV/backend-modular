import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectAnswers, ScaffoldResult } from "../types.js";
import { commonEnv, replaceEnv } from "./env.js";
import { copyTemplate, transformText } from "./files.js";
export async function scaffoldGolang(source: string, answers: ProjectAnswers): Promise<ScaffoldResult> {
  if (!answers.goModulePath) throw new Error("Go module path is required");
  const env = replaceEnv(await readFile(join(source, ".env.example"), "utf8"), { ...commonEnv(answers), USER_PASSWORD: randomBytes(24).toString("base64url"), OTEL_SERVICE_NAME: answers.deploymentName });
  const manifest = await copyTemplate(source, answers);
  const modulePath = answers.goModulePath;
  await transformText(answers.targetDirectory, (content, name) => name === "template-manifest.json" ? content : content.replaceAll(manifest.identity, modulePath));
  await writeFile(join(answers.targetDirectory, ".env"), env, { flag: "wx", mode: 0o600 });
  return { projectDirectory: answers.targetDirectory, templateId: "golang" };
}
