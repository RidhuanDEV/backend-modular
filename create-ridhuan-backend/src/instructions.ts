import { templateRegistry, usesLocalStorage } from "./templates.js";
import type { ProjectAnswers, TemplateManifest } from "./types.js";
export function nextSteps(answers: ProjectAnswers, noInstall: boolean): string[] {
  const descriptor = templateRegistry[answers.templateId];
  const steps = [`cd "${answers.projectName}"`];
  if (answers.mode === "docker") {
    steps.push("docker compose up --build -d --wait");
    steps.push(answers.templateId === "dotnet" ? "docker compose --profile seed run --rm seeder" :
      answers.templateId === "golang" ? "docker compose run --rm --entrypoint seed app" :
      answers.templateId === "nestjs" ? "docker compose exec app npm run seed" : answers.templateId === "fastapi" ? "docker compose exec app backend seed" : "docker compose exec app npm run seed:prod");
  } else {
    if (noInstall) steps.push(`${descriptor.install.command} ${descriptor.install.args.join(" ")}${answers.templateId === "fastapi" ? ` --extra ${answers.databaseProvider}` : ""}`);
    steps.push(`# Provide ${answers.databaseProvider} ${answers.dbHost}:${answers.dbPort} and create database ${answers.dbName} first.`);
    if (answers.templateId === "dotnet") {
      const loader = process.platform === "win32" ? "pwsh -File scripts/run.ps1" : "python3 scripts/run.py";
      steps.push(`${loader} run --project tools/${answers.namespace}.Migrator`, `${loader} build -c Release --no-restore`, `${loader} run --project tools/${answers.namespace}.Seeder`, loader);
    } else if (answers.templateId === "golang") steps.push(process.platform === "win32" ? '$env:GOWORK = "off"' : "export GOWORK=off", "go run ./cmd/migrate", "go run ./cmd/seed", "go run ./cmd/api");
    else if (answers.templateId === "fastapi") steps.push("uv run --locked backend migrate", "uv run --locked backend seed", "uv run --locked backend serve");
    else steps.push("npm run prisma:migrate:deploy", "npm run build", "npm run seed", "npm start");
  }
  steps.push(`# API: http://localhost:${answers.appPort}; readiness: /ready; API docs: /docs`, "# Fresh bootstrap credentials are in .env; never commit this file.");
  return steps;
}
export function gettingStarted(answers: ProjectAnswers, manifest: TemplateManifest): string {
  const manual = nextSteps({ ...answers, mode: "manual" }, true).slice(1).join("\n");
  const docker = nextSteps({ ...answers, mode: "docker" }, true).slice(1).join("\n");
  const descriptor = templateRegistry[answers.templateId];
  const localS3 = usesLocalStorage(answers);
  const revision = manifest.source.commit ?? "uncommitted development source";
  return `# ${answers.projectName}\n\n${descriptor.label}; ${answers.databaseProvider}; template source revision \`${revision}\`${manifest.source.dirty ? " (development snapshot)" : ""}.\n\n` +
    `Runtime requirements: ${Object.entries(manifest.requirements).map(([key, value]) => `${key} ${value}`).join(", ")}.\n\n` +
    `Setup choices are in the ignored .env. Restart/redeploy after changing them. Bootstrap passwords were generated; inspect .env locally.\n\n` +
    `## Manual\n\nProvide ${answers.databaseProvider} and the enabled Redis/S3 services first. Use an empty database owned by this application.\n\n\`\`\`sh\n${manual}\n\`\`\`\n\n` +
    `On Windows use pwsh -File scripts/run.ps1 for .NET; on Linux/macOS use python3 scripts/run.py. Go projects inside an unrelated workspace can run with GOWORK=off set in the current terminal.\n\n` +
    `## Docker Compose\n\nDocker Engine and Compose v2 are required; host Node/Go/.NET/Python build tools are optional. Redis/S3 development profiles follow COMPOSE_PROFILES.\n\n\`\`\`sh\n${docker}\n\`\`\`\n\n` +
    `For a host API with container dependencies, run docker compose up -d ${answers.databaseProvider === "mysql" ? "mysql" : "postgres"}${answers.enableRedis ? " redis" : ""}${localS3 ? descriptor.storageHost.startsWith("minio") ? " minio-init" : " s3mock" : ""}. Host connection settings are separate from container URLs.\n\n` +
    `Migrations run once before new replicas; seed stays explicit. Local/S3 upload, Redis rate limiting/cache and SMTP configuration follow README.md and .env.example. /live checks HTTP; /ready checks required dependencies.\n`;
}
