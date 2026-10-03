import { templateRegistry, usesLocalStorage } from "./templates.js";
import type { ProjectAnswers, TemplateManifest } from "./types.js";
export function nextSteps(
  answers: ProjectAnswers,
  noInstall: boolean,
): string[] {
  const descriptor = templateRegistry[answers.templateId];
  const steps = [`cd "${answers.projectName}"`];
  if (answers.mode === "docker") {
    if (answers.templateId === "springboot") steps.push("docker compose build app", "docker compose up -d --wait");
    else steps.push("docker compose up --build -d --wait");
    steps.push(
      (answers.templateId === "springboot" || answers.templateId === "laravel")
        ? "docker compose --profile seed run --rm seeder"
        : answers.templateId === "dotnet"
        ? "docker compose --profile seed run --rm seeder"
        : answers.templateId === "golang"
          ? "docker compose run --rm --entrypoint seed app"
          : answers.templateId === "nestjs"
            ? "docker compose exec app npm run seed"
            : answers.templateId === "fastapi"
              ? "docker compose exec app backend seed"
              : "docker compose exec app npm run seed:prod",
    );
  } else {
    if (noInstall)
      steps.push(
        `${descriptor.install.command === "mvnw" ? process.platform === "win32" ? ".\\mvnw.cmd" : "./mvnw" : descriptor.install.command} ${descriptor.install.args.map(argument => answers.templateId === "springboot" && argument.startsWith("-D") ? '"' + argument + '"' : argument).join(" ")}${answers.templateId === "fastapi" ? ` --extra ${answers.databaseProvider}` : ""}`,
      );
    steps.push(
      `# Provide ${answers.databaseProvider} ${answers.dbHost}:${answers.dbPort} and create database ${answers.dbName} first.`,
    );
    if (answers.templateId === "springboot") {
      steps.push(`${process.platform === "win32" ? ".\\mvnw.cmd" : "./mvnw"} -B "-Dmaven.test.skip=true" package`, "java -jar target/app.jar --app.mode=migrate", "java -jar target/app.jar --app.mode=seed", "java -jar target/app.jar --app.mode=http");
    } else if (answers.templateId === "laravel") {
      steps.push("php artisan backend:migrate --force", "php artisan backend:seed", "php artisan serve --host=127.0.0.1 --port=" + answers.appPort);
    } else if (answers.templateId === "dotnet") {
      const loader =
        process.platform === "win32"
          ? "pwsh -File scripts/run.ps1"
          : "python3 scripts/run.py";
      steps.push(
        `${loader} run --project tools/${answers.namespace}.Migrator`,
        `${loader} build -c Release --no-restore`,
        `${loader} run --project tools/${answers.namespace}.Seeder`,
        loader,
      );
    } else if (answers.templateId === "golang")
      steps.push(
        process.platform === "win32"
          ? '$env:GOWORK = "off"'
          : "export GOWORK=off",
        "go run ./cmd/migrate",
        "go run ./cmd/seed",
        "go run ./cmd/api",
      );
    else if (answers.templateId === "fastapi")
      steps.push(
        "uv run --locked backend migrate",
        "uv run --locked backend seed",
        "uv run --locked backend serve",
      );
    else
      steps.push(
        "npm run prisma:migrate:deploy",
        "npm run build",
        "npm run seed",
        "npm start",
      );
  }
  steps.push(
    `# API: http://localhost:${answers.appPort}; readiness: /ready; API docs: /docs`,
    "# Fresh bootstrap credentials are in .env; never commit this file.",
  );
  if (answers.mode === "manual") {
    steps.push(
      "# In a separate terminal, run the SMTP outbox worker (SMTP disabled => no-op):",
    );
    if (answers.templateId === "springboot") steps.push("java -jar target/app.jar --app.mode=email-worker");
    else if (answers.templateId === "laravel") steps.push("php artisan notifications:work");
    else if (answers.templateId === "dotnet")
      steps.push(
        `${process.platform === "win32" ? "pwsh -File scripts/run.ps1" : "python3 scripts/run.py"} run --project tools/${answers.namespace}.Worker`,
      );
    else
      steps.push(
        answers.templateId === "golang"
          ? "go run ./cmd/worker"
          : answers.templateId === "fastapi"
            ? "uv run --locked backend worker"
            : "npm run worker",
      );
  }
  return steps;
}
export function gettingStarted(
  answers: ProjectAnswers,
  manifest: TemplateManifest,
): string {
  const manual = nextSteps({ ...answers, mode: "manual" }, true)
    .slice(1)
    .join("\n");
  const docker = nextSteps({ ...answers, mode: "docker" }, true)
    .slice(1)
    .join("\n");
  const descriptor = templateRegistry[answers.templateId];
  const localS3 = usesLocalStorage(answers);
  const revision = manifest.source.commit ?? "uncommitted development source";
  return (
    `# ${answers.projectName}\n\n${descriptor.label}; ${answers.databaseProvider}; template source revision \`${revision}\`${manifest.source.dirty ? " (development snapshot)" : ""}.\n\n` +
    `Runtime requirements: ${Object.entries(manifest.requirements)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ")}.\n\n` +
    `Setup choices are in the ignored .env. Restart/redeploy after changing them. Bootstrap passwords were generated; inspect .env locally.\n\n` +
    `## Manual\n\nProvide ${answers.databaseProvider} and the enabled Redis/S3 services first. Use an empty database owned by this application.\n\n\`\`\`sh\n${manual}\n\`\`\`\n\n` +
    `On Windows use pwsh -File scripts/run.ps1 for .NET; on Linux/macOS use python3 scripts/run.py. Go projects inside an unrelated workspace can run with GOWORK=off set in the current terminal.\n\n` +
    `## Docker Compose\n\nDocker Engine and Compose v2 are required; host Node/Go/.NET/Python/Java/PHP build tools are optional. Redis/S3 development profiles follow COMPOSE_PROFILES.\n\n\`\`\`sh\n${docker}\n\`\`\`\n\n` +
    `For a host API with container dependencies, run docker compose up -d ${answers.databaseProvider === "mysql" ? "mysql" : "postgres"}${answers.enableRedis ? " redis" : ""}${localS3 ? (descriptor.storageHost.startsWith("minio") ? " minio-init" : " s3mock") : ""}. Host connection settings are separate from container URLs.\n\n` +
    `Migrations run once before new replicas; seed stays explicit. Compose includes a separate worker; SMTP disabled makes it a no-op. SMTP delivery is at least once: a crash after acceptance may deliver the same email again.\n\n` +
    `Cleanup is a separate scheduled command, dry-run by default. Read docs/HARDENING-UPGRADE.md for cleanup commands, retention, sliding refresh sessions, SSE cursors, worker lease/retry configuration and optional telemetry. No cleanup runs during HTTP startup.\n\n` +
    `Local/S3 upload, Redis rate limiting/cache and SMTP configuration follow README.md and .env.example. /live checks HTTP; /ready checks required dependencies.\n`
  );
}
