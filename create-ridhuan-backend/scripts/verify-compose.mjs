import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { command } from "../dist/process.js";
import pg from "pg";
import { verifyProviderUpgrade } from "./verify-upgrade.mjs";
import { verifyHardening } from "./verify-hardening.mjs";
import { verifyHardeningUpgrade } from "./verify-hardening-upgrade.mjs";
import { verifyWorkerRetention } from "./verify-worker-retention.mjs";
import { randomUUID, X509Certificate } from "node:crypto";
import { verifyDatabaseConnection } from "../dist/prompts/db-check.js";
const id = process.argv[2];
if (
  !["express-typescript", "nestjs", "golang", "dotnet", "fastapi"].includes(id)
)
  throw new Error("Supply a template ID");
const database = process.argv[3] ?? "postgresql";
if (!["postgresql", "mysql"].includes(database))
  throw new Error("Supply postgresql or mysql");
const root = resolve(import.meta.dirname, ".."),
  scratch = await mkdtemp(join(tmpdir(), `ridhuan ${id} compose-`));
const name = id === "dotnet" ? "Acceptance.Api" : "acceptance-api",
  project = join(scratch, name);
const base =
  id === "express-typescript" ? "docker-compose.yml" : "compose.yaml";
const originalDb = process.env.RIDHUAN_DB_PASSWORD;
const inheritedFixtureEnv = new Map();
const dbPassword = "fixture #$HOME apostrophe' quote\" back\\'slash-日本;end\\";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      18000 + Math.floor(Math.random() * 10000),
      "127.0.0.1",
      resolve,
    );
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const port = await freePort(),
  dbPort = await freePort(),
  redisPort = await freePort(),
  storagePort = await freePort(),
  consolePort = await freePort();
function run(name, args, cwd = project, inherit = true) {
  const result = command(name, args, cwd, inherit);
  if (result.status !== 0 || result.error)
    throw new Error(`${name} ${args.slice(0, 3).join(" ")} failed (exit ${result.status}; signal ${result.signal}; code ${result.error?.code ?? "none"})`);
  return result.stdout;
}
const compose = (...args) =>
  run("docker", [
    "compose",
    "-f",
    base,
    "-f",
    ".tmp-consumer-ports.yaml",
    ...args,
  ]);
const envValue = (text, key) => {
  const value = text
    .split(/\r?\n/)
    .find((line) => line.startsWith(key + "="))
    ?.slice(key.length + 1);
  assert(value !== undefined, `Missing ${key}`);
  if (value.startsWith('"') && value.endsWith('"'))
    return JSON.parse(value.replaceAll("\\$", "$"));
  return value.startsWith("'") && value.endsWith("'")
    ? value.slice(1, -1).replaceAll("\\'", "'")
    : value;
};
const baseURL = `http://127.0.0.1:${port}`;
async function emailSent(notification, token) {
  assert.equal(
    notification.emailStatus,
    "PENDING",
    "SMTP work must be queued before delivery",
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    const rows = (await request("/api/notifications", { token })).data;
    const current = rows.find((item) => item.id === notification.id);
    if (current?.emailStatus === "SENT") return;
    assert.notEqual(
      current?.emailStatus,
      "FAILED",
      "Email worker failed delivery",
    );
    await pause(500);
  }
  throw new Error("Email worker did not finish queued notification");
}
async function request(
  path,
  { method = "GET", body, token, status = 200 } = {},
) {
  const response = await fetch(baseURL + path, {
    method,
    headers: {
      connection: "close",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, status, `${method} ${path}: unexpected status`);
  return status === 204 ? null : await response.json();
}
async function health(path, expected) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(baseURL + path, {
        headers: { connection: "close" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === expected) return;
    } catch {}
    await pause(1000);
  }
  throw new Error(`${path} did not reach ${expected}`);
}
let started = false;
try {
  let tarball = process.env.CLI_TARBALL;
  if (!tarball) {
    const pack = command(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
      root,
    );
    assert.equal(pack.status, 0);
    tarball = join(scratch, JSON.parse(pack.stdout)[0].filename);
  }
  await writeFile(
    join(scratch, "package.json"),
    '{"name":"compose-consumer","private":true}\n',
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      resolve(tarball),
    ],
    scratch,
  );
  process.env.RIDHUAN_DB_PASSWORD = dbPassword;
  run(
    process.execPath,
    [
      join(scratch, "node_modules/create-ridhuan-backend/dist/bin/index.js"),
      name,
      "--template",
      id,
      "--database",
      database,
      "--mode",
      "docker",
      "--port",
      String(port),
      "--db-port",
      String(dbPort),
      "--storage",
      "s3",
      "--redis",
      "--yes",
    ],
    scratch,
  );
  // Disposable SMTP/Collector fixtures never belong in the application image context.
  await writeFile(
    join(project, ".dockerignore"),
    (await readFile(join(project, ".dockerignore"), "utf8")) +
      "\nconsumer-fixtures/\n",
  );
  if (originalDb === undefined) delete process.env.RIDHUAN_DB_PASSWORD;
  else process.env.RIDHUAN_DB_PASSWORD = originalDb;
  const generatedEnv = await readFile(join(project, ".env"), "utf8");
  for (const line of generatedEnv.split(/\r?\n/))
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) {
      const key = line.slice(0, line.indexOf("="));
      inheritedFixtureEnv.set(key, process.env[key]);
      process.env[key] = envValue(generatedEnv, key);
    }
  const fixtureStorage = id === "dotnet" ? "s3mock" : "minio";
  await writeFile(
    join(project, ".tmp-consumer-ports.yaml"),
    `services:\n  app:\n    environment:\n      ${id === "dotnet" ? "Rate__Auth__Max" : "RATE_LIMIT_AUTH_MAX"}: "10000"\n      ${id === "dotnet" ? "Rate__Internal__Max" : "RATE_LIMIT_INTERNAL_MAX"}: "10000"\n      ENDPOINT_POLICIES_JSON: '{"auth.refresh":{"audit":"required"},"auth.logout":{"audit":"required"}}'\n  redis:\n    ports: !override ["127.0.0.1:${redisPort}:6379"]\n  ${fixtureStorage}:\n    ports: !override ["127.0.0.1:${storagePort}:${id === "dotnet" ? 9090 : 9000}"${id === "dotnet" ? "" : `, "127.0.0.1:${consolePort}:9001"`}]\n`,
  );
  const initialOverride = await readFile(
    join(project, ".tmp-consumer-ports.yaml"),
    "utf8",
  );
  await writeFile(
    join(project, ".tmp-consumer-ports.yaml"),
    initialOverride.replace(
      "  app:\n    environment:\n",
      "  app:\n    environment:\n      " +
        (id === "dotnet" ? "Rate__Public__Max" : "RATE_LIMIT_PUBLIC_MAX") +
        ': "10000"\n',
    ),
  );
  const config = JSON.parse(
    run(
      "docker",
      [
        "compose",
        "-f",
        base,
        "-f",
        ".tmp-consumer-ports.yaml",
        "config",
        "--format",
        "json",
      ],
      project,
      false,
    ),
  );
  assert.equal(
    String(
      config.services.app.environment.PORT ??
        config.services.app.environment.ASPNETCORE_URLS,
    ),
    id === "dotnet"
      ? "http://+:8080"
      : id === "golang"
        ? "8080"
        : id === "fastapi"
          ? "8000"
          : "3000",
  );
  assert(config.services.redis && config.services[fixtureStorage]);
  // Actual database startup verifies Compose quoting and URI/Npgsql credentials, including punctuation and Unicode.
  started = true;
  // Prove a failed release migration blocks the API before applying any schema.
  await writeFile(
    join(project, ".tmp-migration-failure.yaml"),
    'services:\n  migrate:\n    entrypoint: ["sh", "-c", "exit 23"]\n    command: []\n',
  );
  const blocked = command(
    "docker",
    [
      "compose",
      "-f",
      base,
      "-f",
      ".tmp-consumer-ports.yaml",
      "-f",
      ".tmp-migration-failure.yaml",
      "up",
      "--build",
      "-d",
      "app",
    ],
    project,
  );
  assert.notEqual(blocked.status, 0, "Failed migration must prevent startup");
  const blockedApp = run(
    "docker",
    [
      "compose",
      "-f",
      base,
      "-f",
      ".tmp-consumer-ports.yaml",
      "ps",
      "-a",
      "-q",
      "app",
    ],
    project,
    false,
  ).trim();
  if (!blockedApp) {
    console.error(
      (blocked.stdout ?? "")
        .replaceAll(dbPassword, "[fixture-password]")
        .replaceAll(encodeURIComponent(dbPassword), "[fixture-password]"),
    );
    console.error(
      (blocked.stderr ?? "")
        .replaceAll(dbPassword, "[fixture-password]")
        .replaceAll(encodeURIComponent(dbPassword), "[fixture-password]"),
    );
    throw new Error(
      "Compose failed before creating the application; migration failure gate was not reached",
    );
  }
  assert.equal(
    run(
      "docker",
      ["inspect", "--format", "{{.State.Status}}", blockedApp],
      project,
      false,
    ).trim(),
    "created",
  );
  const blockedMigration = run(
    "docker",
    [
      "compose",
      "-f",
      base,
      "-f",
      ".tmp-consumer-ports.yaml",
      "ps",
      "-a",
      "-q",
      "migrate",
    ],
    project,
    false,
  ).trim();
  const migrationExit = run(
    "docker",
    ["inspect", "--format", "{{.State.ExitCode}}", blockedMigration],
    project,
    false,
  ).trim();
  if (migrationExit !== "23") {
    console.error(
      command(
        "docker",
        ["compose", "-f", base, "-f", ".tmp-consumer-ports.yaml", "ps", "-a"],
        project,
      ).stdout,
    );
    console.error(
      command(
        "docker",
        [
          "compose",
          "-f",
          base,
          "-f",
          ".tmp-consumer-ports.yaml",
          "logs",
          "--tail",
          "20",
          database === "mysql" ? "mysql" : "postgres",
        ],
        project,
      ).stdout,
    );
  }
  assert.equal(migrationExit, "23");
  compose("down", "-v", "--remove-orphans");
  compose("up", "--build", "-d", "--wait", "--wait-timeout", "240");
  const env = await readFile(join(project, ".env"), "utf8");
  await verifyHardeningUpgrade({
    project,
    id,
    database,
    dbPort,
    envValue,
    env,
    dbPassword,
    run,
  });
  const dbCheck = await verifyDatabaseConnection(
    database,
    "127.0.0.1",
    dbPort,
    envValue(env, database === "mysql" ? "MYSQL_USER" : "POSTGRES_USER"),
    dbPassword,
    envValue(env, database === "mysql" ? "MYSQL_DATABASE" : "POSTGRES_DB"),
  );
  assert.equal(dbCheck.status, "connected");
  assert.equal(
    (
      await verifyDatabaseConnection(
        database,
        "127.0.0.1",
        dbPort,
        envValue(env, database === "mysql" ? "MYSQL_USER" : "POSTGRES_USER"),
        "wrong-password",
        envValue(env, database === "mysql" ? "MYSQL_DATABASE" : "POSTGRES_DB"),
      )
    ).status,
    "authentication_failed",
  );
  assert.equal(
    (
      await verifyDatabaseConnection(
        database,
        "127.0.0.1",
        dbPort,
        envValue(env, database === "mysql" ? "MYSQL_USER" : "POSTGRES_USER"),
        dbPassword,
        "missing_database",
      )
    ).status,
    database === "mysql" ? "database_access_denied" : "database_missing",
  );
  if (database === "mysql")
    assert.equal(
      (
        await verifyDatabaseConnection(
          database,
          "127.0.0.1",
          dbPort,
          "root",
          envValue(env, "MYSQL_ROOT_PASSWORD"),
          "missing_database",
        )
      ).status,
      "database_missing",
    );
  if (
    database === "postgresql" &&
    (id === "express-typescript" || id === "nestjs")
  ) {
    const admin = new pg.Client({
      host: "127.0.0.1",
      port: dbPort,
      user: envValue(env, "POSTGRES_USER"),
      password: dbPassword,
      database: "postgres",
    });
    await admin.connect();
    const upgradeName = "consumer_upgrade_" + randomUUID().replaceAll("-", "");
    let upgrade;
    try {
      await admin.query('CREATE DATABASE "' + upgradeName + '"');
      upgrade = new pg.Client({
        host: "127.0.0.1",
        port: dbPort,
        user: envValue(env, "POSTGRES_USER"),
        password: dbPassword,
        database: upgradeName,
      });
      await upgrade.connect();
      const initial =
        id === "nestjs" ? "20260929000000_init" : "20260524120000_init";
      await upgrade.query(
        await readFile(
          join(project, "prisma/migrations", initial, "migration.sql"),
          "utf8",
        ),
      );
      const roles = id === "nestjs" ? "roles" : "Role";
      const fixtureID = randomUUID();
      await upgrade.query(
        'INSERT INTO "' +
          roles +
          '" (id,name,"createdAt","updatedAt") VALUES ($1,$2,$3,$3)',
        [fixtureID, "upgrade-fixture", "2026-01-01T00:00:00Z"],
      );
      const url = new URL(envValue(env, "DATABASE_URL_DOCKER"));
      url.pathname = "/" + upgradeName;
      for (const action of [["resolve", "--applied", initial], ["deploy"]]) {
        // Capture output: URLs carry synthetic fixture passwords and must not enter logs.
        run(
          "docker",
          [
            "compose",
            "-f",
            base,
            "-f",
            ".tmp-consumer-ports.yaml",
            "run",
            "--rm",
            "--no-deps",
            "-e",
            "DATABASE_URL=" + url.toString(),
            "--entrypoint",
            "node",
            "migrate",
            "node_modules/prisma/build/index.js",
            "migrate",
            ...action,
          ],
          project,
          false,
        );
      }
      const preserved = await upgrade.query(
        'SELECT "createdAt" FROM "' + roles + '" WHERE id=$1',
        [fixtureID],
      );
      assert.equal(
        preserved.rows[0].createdAt.toISOString(),
        "2026-01-01T00:00:00.000Z",
      );
      await upgrade.query(
        'SELECT id FROM "' +
          (id === "nestjs" ? "notifications" : "Notification") +
          '" LIMIT 0',
      );
    } finally {
      await upgrade?.end();
      await admin.query(
        'DROP DATABASE IF EXISTS "' + upgradeName + '" WITH (FORCE)',
      );
      await admin.end();
    }
  } else if (
    (id === "golang" && database === "postgresql") ||
    id === "dotnet"
  ) {
    const verifyService =
      id === "golang"
        ? `  upgradeverify:\n    profiles: [verification]\n    build: {context: ., target: build}\n    environment:\n      DATABASE_URL: \${DATABASE_URL_DOCKER}\n    command: ["go", "test", "-p", "1", "./internal/db", "-run", "TestFreshDatabaseUpgradePreservesExistingData", "-count=1"]\n`
        : `  upgradeverify:\n    profiles: [verification]\n    build: {context: ., target: build}\n    environment:\n      Database__Provider: ${database}\n      Database__ConnectionString: ${database === "mysql" ? "Server=mysql;Database=mysql;User ID=root;Password=" + envValue(env, "MYSQL_ROOT_PASSWORD") + ";SslMode=Preferred" : "\${Database__ConnectionString_DOCKER}"}\n    command: ["dotnet", "test", "tests/AcceptanceApi.IntegrationTests", "-c", "Release", "--no-restore", "--filter", "FullyQualifiedName~UpgradePreservesExistingDataAndSeedNeverResetsPassword"]\n`;
    await writeFile(
      join(project, ".tmp-consumer-ports.yaml"),
      (await readFile(join(project, ".tmp-consumer-ports.yaml"), "utf8")) +
        verifyService,
    );
    compose("run", "--build", "--rm", "--no-deps", "upgradeverify");
  }
  if (id === "fastapi" || (database === "mysql" && id !== "dotnet"))
    await verifyProviderUpgrade({
      project,
      id,
      database,
      env,
      dbPort,
      dbPassword,
      run,
      compose,
    });

  if (id === "dotnet") compose("--profile", "seed", "run", "--rm", "seeder");
  else if (id === "golang")
    compose("run", "--rm", "--entrypoint", "seed", "app");
  else if (id === "fastapi") compose("exec", "-T", "app", "backend", "seed");
  else
    compose(
      "exec",
      "-T",
      "app",
      "npm",
      "run",
      id === "nestjs" ? "seed" : "seed:prod",
    );
  // Seed is explicit and idempotent.
  if (id === "dotnet") compose("--profile", "seed", "run", "--rm", "seeder");
  else if (id === "golang")
    compose("run", "--rm", "--entrypoint", "seed", "app");
  else if (id === "fastapi") compose("exec", "-T", "app", "backend", "seed");
  else
    compose(
      "exec",
      "-T",
      "app",
      "npm",
      "run",
      id === "nestjs" ? "seed" : "seed:prod",
    );
  await health("/ready", 200);
  await health("/live", 200);
  const docs = await request("/docs/openapi.json");
  assert(docs.paths["/api/auth/login"]);
  const credentials = {
    email: envValue(env, id === "dotnet" ? "Bootstrap__Email" : "ADMIN_EMAIL"),
    password: envValue(
      env,
      id === "dotnet" ? "Bootstrap__Password" : "ADMIN_PASSWORD",
    ),
  };
  const setAuditMode = async (mode) => {
    const current = await readFile(
      join(project, ".tmp-consumer-ports.yaml"),
      "utf8",
    );
    const updated = current.replace(
      /ENDPOINT_POLICIES_JSON: '.+'/,
      "ENDPOINT_POLICIES_JSON: '" +
        JSON.stringify({
          "auth.refresh": { audit: mode },
          "auth.logout": { audit: mode },
        }) +
        "'",
    );
    await writeFile(join(project, ".tmp-consumer-ports.yaml"), updated);
    compose("up", "-d", "--no-deps", "app");
    await health("/ready", 200);
  };
  await verifyHardening({
    id,
    database,
    dbPort,
    dbUser: envValue(
      env,
      database === "mysql" ? "MYSQL_USER" : "POSTGRES_USER",
    ),
    dbPassword,
    dbName: envValue(
      env,
      database === "mysql" ? "MYSQL_DATABASE" : "POSTGRES_DB",
    ),
    baseURL,
    credentials,
    jwtSecret: envValue(env, id === "dotnet" ? "Jwt__Secret" : "JWT_SECRET"),
    setAuditMode,
    ...(database === "mysql"
      ? { rootPassword: envValue(env, "MYSQL_ROOT_PASSWORD") }
      : {}),
  });
  const login = await request("/api/auth/login", {
    method: "POST",
    body: credentials,
  });
  assert.equal(
    typeof login.data[id === "dotnet" ? "accessToken" : "token"],
    "string",
  );
  assert.equal(typeof login.data.refreshToken, "string");
  const jwt = JSON.parse(
    Buffer.from(
      login.data[id === "dotnet" ? "accessToken" : "token"].split(".")[1],
      "base64url",
    ).toString(),
  );
  assert(jwt.exp - (id === "dotnet" ? jwt.nbf : jwt.iat) <= 900);
  const token = login.data[id === "dotnet" ? "accessToken" : "token"];
  const me = (await request("/api/auth/me", { token })).data;
  assert(me.id);
  assert(!("password" in me));
  assert(!("passwordHash" in me));
  if (id === "dotnet") {
    // RedisTimeoutException is distinct from RedisException. Exercise real
    // latency, rather than only a disconnected socket, on this owned Redis.
    // Repeat the controlled latency boundary to detect intermittent failures
    // after the multiplexer has recovered, without automatically rerunning a
    // failed assertion or hiding its status.
    for (let iteration = 0; iteration < 3; iteration++) {
      compose("exec", "-T", "redis", "redis-cli", "CLIENT", "PAUSE", "4000");
      await request("/api/auth/login", {
        method: "POST",
        body: credentials,
        status: 503,
      });
      await new Promise((resolve) => setTimeout(resolve, 4500));
      compose("exec", "-T", "redis", "redis-cli", "CLIENT", "PAUSE", "7000");
      await request(`/api/users/${me.id}`, { token });
      await new Promise((resolve) => setTimeout(resolve, 7500));
      await request("/ready");
    }
  }
  const created = (
    await request("/api/notifications", {
      method: "POST",
      token,
      body: {
        recipientId: me.id,
        title: "Consumer acceptance",
        body: "Persist and stream",
        sendEmail: true,
      },
      status: 201,
    })
  ).data;
  assert.equal(created.emailStatus, "FAILED");
  const streamAbort = new AbortController();
  const timer = setTimeout(() => streamAbort.abort(), 12000);
  try {
    const stream = await fetch(baseURL + "/api/notifications/stream", {
      headers: { connection: "close", authorization: `Bearer ${token}` },
      signal: streamAbort.signal,
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type"), /text\/event-stream/);
    const reader = stream.body.getReader();
    let text = "";
    while (!text.includes(created.id)) {
      const chunk = await reader.read();
      assert(!chunk.done);
      text += new TextDecoder().decode(chunk.value);
    }
    await reader.cancel();
  } finally {
    clearTimeout(timer);
    streamAbort.abort();
  }
  assert(
    (await request("/api/notifications", { token })).data.some(
      (item) => item.id === created.id,
    ),
  );
  assert(
    (
      await request(`/api/notifications/${created.id}/read`, {
        method: "PATCH",
        token,
      })
    ).data.readAt,
  );
  const strangerCredentials = {
    email: "stranger@example.test",
    password: "Synthetic-fixture-password-43",
  };
  await request("/api/auth/register", {
    method: "POST",
    body: strangerCredentials,
    status: 201,
  });
  const strangerLogin = (
    await request("/api/auth/login", {
      method: "POST",
      body: strangerCredentials,
    })
  ).data;
  const strangerToken =
    strangerLogin[id === "dotnet" ? "accessToken" : "token"];
  assert(
    !(await request("/api/notifications", { token: strangerToken })).data.some(
      (item) => item.id === created.id,
    ),
  );
  await request(`/api/notifications/${created.id}/read`, {
    method: "PATCH",
    token: strangerToken,
    status: 404,
  });
  await request("/api/notifications", {
    method: "POST",
    token: strangerToken,
    body: { recipientId: me.id, title: "Forbidden", body: "No permission" },
    status: 403,
  });
  await request("/api/users/" + me.id, { token }); // warm the configured cache example.

  const form = new FormData();
  form.append(
    "file",
    new Blob(["%PDF-1.4\nfixture"], { type: "application/pdf" }),
    "fixture.pdf",
  );
  const upload = await fetch(baseURL + "/api/upload", {
    method: "POST",
    headers: { connection: "close", authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(upload.status, 201);
  const uploaded = (await upload.json()).data;
  assert(uploaded.id);
  assert(
    (await request(`/api/upload/${uploaded.id}`, { token })).data.id ===
      uploaded.id,
  );
  const rotated = (
    await request("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: login.data.refreshToken },
    })
  ).data;
  assert.notEqual(rotated.refreshToken, login.data.refreshToken);
  if (docs.paths["/api/auth/logout"])
    await request("/api/auth/logout", {
      method: "POST",
      body: { refreshToken: rotated.refreshToken },
      status: 204,
    });

  // Real SMTP transport and local uploads after a configuration redeploy.
  const fixtureDir = join(project, "consumer-fixtures");
  await mkdir(fixtureDir);
  await writeFile(
    join(fixtureDir, "smtp.mjs"),
    await readFile(join(root, "scripts/fixtures/smtp-tls.mjs")),
  );
  await writeFile(
    join(fixtureDir, "Dockerfile"),
    `FROM node:24.15.0-alpine
WORKDIR /fixture
RUN apk add --no-cache openssl && mkdir certs
ARG FIXTURE_CERT_NONCE
RUN test -n "$FIXTURE_CERT_NONCE" && openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 2 -subj /CN=mailfixture -addext subjectAltName=DNS:mailfixture > /dev/null 2>&1 && chmod 644 certs/key.pem
COPY smtp.mjs .
USER node
CMD ["node", "smtp.mjs"]
`,
  );
  const smtpPort = await freePort(),
    replicaPort = await freePort();
  const flags =
    id === "dotnet"
      ? {
          Smtp__Enabled: "true",
          Smtp__Host: "mailfixture",
          Smtp__Port: "1025",
          Smtp__Secure: "false",
          Smtp__From: "sender@example.test",
          Upload__Storage: "local",
        }
      : {
          SMTP_ENABLED: "true",
          SMTP_HOST: "mailfixture",
          SMTP_PORT: "1025",
          SMTP_SECURE: "false",
          SMTP_FROM: "sender@example.test",
          UPLOAD_STORAGE: "local",
        };
  let override = await readFile(
    join(project, ".tmp-consumer-ports.yaml"),
    "utf8",
  );
  override = override.replace(/  app:\n    environment:\n(?:      .+\n)+/, "");
  override +=
    '  mailfixture:\n    build:\n      context: ./consumer-fixtures\n      args:\n        FIXTURE_CERT_NONCE: "' +
    randomUUID() +
    '"\n    ports: ["127.0.0.1:' +
    smtpPort +
    ':1080"]\n  app:\n    volumes:\n      - ./consumer-fixtures/ca.pem:/fixture-ca.pem:ro\n    environment:\n      SSL_CERT_FILE: /fixture-ca.pem\n      NODE_EXTRA_CA_CERTS: /fixture-ca.pem\n' +
    Object.entries(flags)
      .map(
        ([key, value]) => "      " + key + ": " + JSON.stringify(value) + "\n",
      )
      .join("");
  await writeFile(join(project, ".tmp-consumer-ports.yaml"), override);
  compose("build", "mailfixture");
  await writeFile(
    join(fixtureDir, "ca.pem"),
    run(
      "docker",
      [
        "compose",
        "-f",
        base,
        "-f",
        ".tmp-consumer-ports.yaml",
        "run",
        "--rm",
        "--no-deps",
        "--entrypoint",
        "cat",
        "mailfixture",
        "/fixture/certs/cert.pem",
      ],
      project,
      false,
    ),
  );
  const fixtureCertificate = new X509Certificate(
    await readFile(join(fixtureDir, "ca.pem")),
  );
  assert(
    Date.parse(fixtureCertificate.validFrom) <= Date.now(),
    "Fixture TLS certificate is not yet valid",
  );
  assert(
    Date.parse(fixtureCertificate.validTo) > Date.now() + 3600000,
    "Fixture TLS certificate expired or too close to expiry",
  );
  compose("up", "--build", "-d", "--wait", "mailfixture", "app");
  await health("/ready", 200);
  compose("exec", "-T", "redis", "redis-cli", "FLUSHDB"); // New SMTP phase uses the normal default rate windows.
  // The separate worker needs the same SMTP trust/configuration as the API.
  override +=
    "  worker:\n    volumes:\n      - ./consumer-fixtures/ca.pem:/fixture-ca.pem:ro\n    environment:\n      SSL_CERT_FILE: /fixture-ca.pem\n      NODE_EXTRA_CA_CERTS: /fixture-ca.pem\n" +
    Object.entries(flags)
      .map(
        ([key, value]) => "      " + key + ": " + JSON.stringify(value) + "\n",
      )
      .join("");
  await writeFile(join(project, ".tmp-consumer-ports.yaml"), override);
  compose("up", "-d", "--wait", "worker");
  const mailed = (
    await request("/api/notifications", {
      method: "POST",
      token,
      body: {
        recipientId: me.id,
        title: "SMTP fixture",
        body: "Delivery check",
        sendEmail: true,
      },
      status: 201,
    })
  ).data;
  await emailSent(mailed, token);
  assert.equal(
    (
      await (
        await fetch(`http://127.0.0.1:${smtpPort}`, {
          signal: AbortSignal.timeout(3000),
        })
      ).json()
    ).messages,
    1,
  );
  const smtpPortKey = id === "dotnet" ? "Smtp__Port" : "SMTP_PORT",
    smtpSecureKey = id === "dotnet" ? "Smtp__Secure" : "SMTP_SECURE";
  override = override
    .replaceAll(
      "      " + smtpPortKey + ': "1025"',
      "      " + smtpPortKey + ': "1465"',
    )
    .replaceAll(
      "      " + smtpSecureKey + ': "false"',
      "      " + smtpSecureKey + ': "true"',
    );
  await writeFile(join(project, ".tmp-consumer-ports.yaml"), override);
  compose("up", "-d", "--no-deps", "--wait", "app", "worker");
  const implicit = (
    await request("/api/notifications", {
      method: "POST",
      token,
      body: {
        recipientId: me.id,
        title: "Implicit TLS",
        body: "TLS delivery check",
        sendEmail: true,
      },
      status: 201,
    })
  ).data;
  await emailSent(implicit, token);
  assert.equal(
    (await (await fetch(`http://127.0.0.1:${smtpPort}`)).json()).messages,
    2,
  );
  // Enable telemetry only in this fixture, retaining native .NET gRPC defaults.
  const collectorConfig = (
    await readFile(join(project, "scripts/otel-collector.yaml"), "utf8")
  ).replace("verbosity: basic", "verbosity: detailed");
  await writeFile(
    join(project, "consumer-fixtures/collector.yaml"),
    collectorConfig,
  );
  const otelKey = id === "dotnet" ? "Telemetry__Enabled" : "OTEL_ENABLED";
  override = override.replaceAll(
    "      NODE_EXTRA_CA_CERTS: /fixture-ca.pem\n",
    "      NODE_EXTRA_CA_CERTS: /fixture-ca.pem\n      " +
      otelKey +
      ': "true"\n',
  );
  override +=
    '  otel-collector:\n    volumes: !override ["./consumer-fixtures/collector.yaml:/etc/otelcol/config.yaml:ro"]\n    ports: !override []\n';
  await writeFile(join(project, ".tmp-consumer-ports.yaml"), override);
  compose(
    "--profile",
    "telemetry",
    "up",
    "-d",
    "--no-deps",
    "otel-collector",
    "app",
    "worker",
  );
  await health("/ready", 200);
  const telemetrySentinel = "private-fixture-" + randomUUID();
  const traceID = "0123456789abcdef0123456789abcdef";
  const traced = await fetch(
    baseURL + "/api/users/" + me.id + "?private=" + telemetrySentinel,
    {
      headers: {
        authorization: `Bearer ${token}`,
        traceparent: "00-" + traceID + "-0123456789abcdef-01",
        "x-request-id": randomUUID(),
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  assert([200, 400, 422].includes(traced.status));
  await request("/api/users/" + me.id, { token }); // Exercise live authorization, database and Redis cache spans.
  const telemetryForm = new FormData();
  telemetryForm.append(
    "file",
    new Blob(["%PDF-1.4\n" + telemetrySentinel], { type: "application/pdf" }),
    "telemetry.pdf",
  );
  assert.equal(
    (
      await fetch(baseURL + "/api/upload", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: telemetryForm,
        signal: AbortSignal.timeout(10000),
      })
    ).status,
    201,
  );
  const telemetryStreamAbort = new AbortController();
  try {
    const stream = await fetch(baseURL + "/api/notifications/stream", {
      headers: { authorization: `Bearer ${token}` },
      signal: telemetryStreamAbort.signal,
    });
    assert.equal(stream.status, 200);
    await stream.body.getReader().cancel();
  } finally {
    telemetryStreamAbort.abort();
  }
  const cleanupArguments = (apply, settings = []) => {
    const mode = apply ? "--apply" : "--dry-run";
    if (id === "dotnet")
      return [
        "run",
        "--rm",
        "--no-deps",
        ...settings,
        "--entrypoint",
        "dotnet",
        "app",
        "/app/cleanup/AcceptanceApi.UploadCleanup.dll",
        mode,
      ];
    if (id === "golang")
      return [
        "run",
        "--rm",
        "--no-deps",
        ...settings,
        "--entrypoint",
        "cleanup-uploads",
        "app",
        mode,
      ];
    if (id === "fastapi")
      return [
        "run",
        "--rm",
        "--no-deps",
        ...settings,
        "--entrypoint",
        "backend",
        "app",
        "cleanup",
        mode,
      ];
    return [
      "run",
      "--rm",
      "--no-deps",
      ...settings,
      "--entrypoint",
      "node",
      "app",
      id === "nestjs"
        ? "dist/tools/cleanup-orphan-uploads.js"
        : "dist/scripts/cleanup-orphan-uploads.js",
      mode,
    ];
  };
  const cleanup = (apply) => compose(...cleanupArguments(apply));
  const composeAsync = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        ["compose", "-f", base, "-f", ".tmp-consumer-ports.yaml", ...args],
        { cwd: project, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                "Async Compose operation failed: " +
                  output.replaceAll(dbPassword, "[fixture-password]"),
              ),
            ),
      );
    });
  const cleanupConcurrent = () =>
    Promise.all([1, 2].map(() => composeAsync(cleanupArguments(true))));
  const stopWorkers = () => composeAsync(["stop", "-t", "35", "worker"]);
  const auditCleanup = (explicit, apply) => {
    const settings = [
      "-e",
      (id === "dotnet" ? "Cleanup__AuditEnabled" : "CLEANUP_AUDIT_ENABLED") +
        "=true",
      "-e",
      (id === "dotnet" ? "Cleanup__AuditDays" : "CLEANUP_AUDIT_DAYS") +
        "=" +
        (explicit ? "365" : ""),
    ];
    const result = command(
      "docker",
      [
        "compose",
        "-f",
        base,
        "-f",
        ".tmp-consumer-ports.yaml",
        ...cleanupArguments(apply, settings),
      ],
      project,
    );
    assert.equal(
      result.status === 0,
      explicit,
      "Audit cleanup requires explicit positive retention days",
    );
  };
  await verifyWorkerRetention({
    id,
    database,
    dbPort,
    dbUser: envValue(
      env,
      database === "mysql" ? "MYSQL_USER" : "POSTGRES_USER",
    ),
    dbPassword,
    dbName: envValue(
      env,
      database === "mysql" ? "MYSQL_DATABASE" : "POSTGRES_DB",
    ),
    baseURL,
    token,
    recipientId: me.id,
    smtpURL: `http://127.0.0.1:${smtpPort}`,
    compose,
    cleanup,
    cleanupConcurrent,
    stopWorkers,
    auditCleanup,
    ...(database === "mysql"
      ? { rootPassword: envValue(env, "MYSQL_ROOT_PASSWORD") }
      : {}),
  });
  let telemetryOutput = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    const logs = command(
      "docker",
      [
        "compose",
        "-f",
        base,
        "-f",
        ".tmp-consumer-ports.yaml",
        "logs",
        "--no-color",
        "otel-collector",
      ],
      project,
    );
    telemetryOutput = (logs.stdout ?? "") + (logs.stderr ?? "");
    if (
      telemetryOutput.includes(traceID) &&
      telemetryOutput.includes("backend.http.requests") &&
      telemetryOutput.includes("backend.email.attempts")
    )
      break;
    await pause(1000);
  }
  assert(
    telemetryOutput.includes(traceID),
    "Incoming traceparent was not propagated",
  );
  for (const metric of [
    "backend.http.requests",
    "backend.http.duration",
    "backend.email.attempts",
    "backend.outbox.backlog",
    "backend.outbox.oldest_age",
    "backend.cleanup.items",
    "backend.sse.connections",
  ])
    assert(telemetryOutput.includes(metric), "Missing exported " + metric);
  for (const sensitive of [
    telemetrySentinel,
    credentials.password,
    credentials.email,
    dbPassword,
  ])
    assert(
      !telemetryOutput.includes(sensitive),
      "Sensitive fixture data in OTLP",
    );
  const operational = command(
    "docker",
    [
      "compose",
      "-f",
      base,
      "-f",
      ".tmp-consumer-ports.yaml",
      "logs",
      "--no-color",
      "app",
      "worker",
    ],
    project,
  );
  const operationalText =
    (operational.stdout ?? "") + (operational.stderr ?? "");
  assert(
    operationalText.includes(traceID),
    "Trace ID missing from structured logs",
  );
  for (const sensitive of [
    telemetrySentinel,
    credentials.password,
    credentials.email,
    dbPassword,
  ])
    assert(
      !operationalText.includes(sensitive),
      "Sensitive fixture data in operational log",
    );
  if (id === "dotnet") {
    override = override.replace(
      "      " + otelKey + ': "true"\n',
      "      " +
        otelKey +
        ': "true"\n      Telemetry__Protocol: "http/protobuf"\n      Telemetry__Endpoint: "http://otel-collector:4318"\n',
    );
    await writeFile(join(project, ".tmp-consumer-ports.yaml"), override);
    compose("up", "-d", "--no-deps", "app");
    await health("/ready", 200);
    const alternateTrace = "fedcba9876543210fedcba9876543210";
    assert(
      (
        await fetch(baseURL + "/live", {
          headers: {
            traceparent: "00-" + alternateTrace + "-0123456789abcdef-01",
          },
        })
      ).ok,
    );
    let alternate = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const logs = command(
        "docker",
        [
          "compose",
          "-f",
          base,
          "-f",
          ".tmp-consumer-ports.yaml",
          "logs",
          "--no-color",
          "otel-collector",
        ],
        project,
      );
      if (
        ((logs.stdout ?? "") + (logs.stderr ?? "")).includes(alternateTrace)
      ) {
        alternate = true;
        break;
      }
      await pause(1000);
    }
    assert(alternate, ".NET HTTP/protobuf exporter failed");
  }
  compose("stop", "otel-collector");
  await health("/ready", 200);
  await health("/live", 200);
  console.log(
    `${id}/${database}: optional Collector profile, traceparent/log correlation, HTTP/outbox/email/cleanup metrics, sensitive-data exclusion and collector outage passed`,
  );

  const localForm = new FormData();
  localForm.append(
    "file",
    new Blob(["%PDF-1.4\nlocal fixture"], { type: "application/pdf" }),
    "local.pdf",
  );
  assert.equal(
    (
      await fetch(baseURL + "/api/upload", {
        method: "POST",
        headers: { connection: "close", authorization: `Bearer ${token}` },
        body: localForm,
      })
    ).status,
    201,
  );
  // Two replicas must enforce one shared Redis login quota.
  const limitKey = id === "dotnet" ? "Rate__Auth__Max" : "RATE_LIMIT_AUTH_MAX";
  override = override.replaceAll(
    "      " + smtpSecureKey + ': "true"\n',
    "      " + smtpSecureKey + ': "true"\n      ' + limitKey + ': "2"\n',
  );
  override +=
    "  replica:\n    extends: {file: " +
    base +
    ", service: app}\n    environment:\n      " +
    limitKey +
    ': \"2\"\n    ports: !override ["127.0.0.1:' +
    replicaPort +
    ":" +
    (id === "golang"
      ? 8080
      : id === "dotnet"
        ? 8080
        : id === "fastapi"
          ? 8000
          : 3000) +
    '"]\n';
  await writeFile(join(project, ".tmp-consumer-ports.yaml"), override);
  compose("up", "-d", "--wait", "app", "replica");
  await health("/ready", 200);
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if (
        (
          await fetch(`http://127.0.0.1:${replicaPort}/ready`, {
            headers: { connection: "close" },
          })
        ).ok
      )
        break;
    } catch {}
    if (attempt === 29) throw new Error("Replica failed readiness");
    await pause(1000);
  }
  compose("exec", "-T", "redis", "redis-cli", "FLUSHDB");
  for (const [index, target] of [
    baseURL,
    `http://127.0.0.1:${replicaPort}`,
    baseURL,
  ].entries()) {
    const response = await fetch(target + "/api/auth/login", {
      method: "POST",
      headers: { connection: "close", "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    assert.equal(
      response.status,
      index < 2 ? 200 : 429,
      "Shared login rate limit failed",
    );
  }
  // Cache-only Redis outage cannot fail readiness. Rate-limit Redis outage must.
  compose("stop", "redis");
  await health("/ready", 503);
  await health("/live", 200);
  const rateStore = id === "dotnet" ? "Rate__Store" : "RATE_LIMIT_STORE";
  override = override.replace(
    "      " + limitKey + ': "2"',
    "      " + limitKey + ': "20"\n      ' + rateStore + ': "memory"',
  );
  await writeFile(join(project, ".tmp-consumer-ports.yaml"), override);
  compose("up", "-d", "--no-deps", "app");
  await health("/ready", 200);
  await request("/api/users/" + me.id, { token }); // cached endpoint still works without Redis.
  const outageStream = await fetch(baseURL + "/api/notifications/stream", {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(outageStream.status, 200);
  compose("stop", database === "mysql" ? "mysql" : "postgres");
  await health("/live", 200);
  await health("/ready", 503);
  const outageReader = outageStream.body.getReader();
  while (!(await outageReader.read()).done) {}

  console.log(
    `${id}/${database}: Compose migration failure gate, fresh/upgrade database, quoted credentials, seed, auth, refresh, public DTO, Redis/S3/local uploads, SMTP, shared limiter, notifications/SSE and readiness passed`,
  );
} catch (error) {
  if (started) {
    const state = command(
      "docker",
      [
        "compose",
        "-f",
        base,
        "-f",
        ".tmp-consumer-ports.yaml",
        "logs",
        "--tail",
        "35",
        "app",
        "migrate",
        "worker",
        "mailfixture",
        "otel-collector",
      ],
      project,
    );
    if (state.status === 0)
      console.error(
        state.stdout
          .replaceAll(dbPassword, "[fixture-password]")
          .replaceAll(encodeURIComponent(dbPassword), "[fixture-password]"),
      );
  }
  throw error;
} finally {
  if (originalDb === undefined) delete process.env.RIDHUAN_DB_PASSWORD;
  else process.env.RIDHUAN_DB_PASSWORD = originalDb;
  if (started) {
    const result = command(
      "docker",
      [
        "compose",
        "-f",
        base,
        "-f",
        ".tmp-consumer-ports.yaml",
        "--profile",
        "*",
        "down",
        "-v",
        "--remove-orphans",
        "--rmi",
        "local",
      ],
      project,
    );
    if (result.status !== 0) {
      console.error("Fixture cleanup failed; project retained:", project);
      process.exitCode = 1;
    }
  }
  for (const [key, value] of inheritedFixtureEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (process.argv.includes("--keep"))
    console.log(`Consumer fixture: ${project}`);
  else {
    if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep))
      throw new Error("Invalid cleanup scope");
    await rm(scratch, { recursive: true, force: true });
  }
}
