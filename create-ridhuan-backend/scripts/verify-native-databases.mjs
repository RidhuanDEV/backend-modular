import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { command } from "../dist/process.js";
import pg from "pg";
import mysql from "mysql2/promise";

const root = resolve(import.meta.dirname, "../..");
const argument = (flag) =>
  process.argv.includes(flag)
    ? process.argv[process.argv.indexOf(flag) + 1]
    : undefined;
const selectedProvider = argument("--provider"),
  selectedFramework = argument("--framework");
if (selectedProvider && !["postgresql", "mysql"].includes(selectedProvider))
  throw new Error("Invalid native provider");
if (
  selectedFramework &&
  !["express", "nestjs", "dotnet", "fastapi", "golang"].includes(
    selectedFramework,
  )
)
  throw new Error("Invalid native framework");
const prefix = "ridhuan-hardening-native-" + randomUUID().slice(0, 8);
const password = "isolated-native-fixture-password";
const containers = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function run(executable, args, cwd = root, env = {}) {
  const result = command(executable, args, cwd, false, env);
  const output = ((result.stdout ?? "") + (result.stderr ?? "")).replaceAll(
    password,
    "[fixture-password]",
  );
  process.stdout.write(output);
  assert.equal(
    result.status,
    0,
    `${executable} ${args.slice(0, 3).join(" ")} failed`,
  );
  return result.stdout;
}
function start(kind, args, port) {
  const name = prefix + "-" + kind;
  containers.push(name);
  run("docker", [
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1::${port}`,
    ...args,
  ]);
  const config = JSON.parse(
    run("docker", [
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      name,
    ]),
  );
  return Number(config[port + "/tcp"][0].HostPort);
}
try {
  const postgres = start(
    "pg",
    [
      "-e",
      "POSTGRES_USER=fixture",
      "-e",
      "POSTGRES_PASSWORD=" + password,
      "-e",
      "POSTGRES_DB=fixture",
      "postgres:18.3-alpine",
    ],
    5432,
  );
  const mysqlPort = start(
    "mysql",
    [
      "-e",
      "MYSQL_ROOT_PASSWORD=" + password,
      "-e",
      "MYSQL_DATABASE=fixture",
      "mysql:8.4",
    ],
    3306,
  );
  const redisPort = start("redis", ["redis:8.6.1-alpine"], 6379);
  const s3Port = start(
    "s3",
    [
      "-e",
      "COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=uploads",
      "-e",
      "JAVA_TOOL_OPTIONS=-Xmx192m",
      "adobe/s3mock:5.2.2",
    ],
    9090,
  );
  const configs = {
    postgresql: {
      host: "127.0.0.1",
      port: postgres,
      user: "fixture",
      password,
      database: "fixture",
    },
    mysql: {
      host: "127.0.0.1",
      port: mysqlPort,
      user: "root",
      password,
      database: "fixture",
    },
  };
  for (const provider of ["postgresql", "mysql"].filter(
    (value) => !selectedProvider || value === selectedProvider,
  )) {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      let client;
      try {
        client =
          provider === "mysql"
            ? await mysql.createConnection(configs[provider])
            : new pg.Client(configs[provider]);
        if (provider === "postgresql") await client.connect();
        await client.query("SELECT 1");
        ready = true;
        break;
      } catch {
        await pause(500);
      } finally {
        if (client) await client.end().catch(() => {});
      }
    }
    assert(ready, provider + " fixture unavailable");
  }
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (
          await fetch(`http://127.0.0.1:${s3Port}/favicon.ico`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        break;
    } catch {}
    if (i === 99) throw new Error("S3 fixture unavailable");
    await pause(500);
  }
  for (const provider of ["postgresql", "mysql"].filter(
    (value) => !selectedProvider || value === selectedProvider,
  )) {
    const admin =
      provider === "mysql"
        ? await mysql.createConnection(configs[provider])
        : new pg.Client(configs[provider]);
    if (provider === "postgresql") await admin.connect();
    try {
      for (const [id, folder] of [
        ["express", "modular-express-typescript-starter-postgre"],
        ["nestjs", "nestjs"],
        ["dotnet", "modular-NET"],
        ["fastapi", "modular-fastapi"],
      ].filter(
        ([value]) => !selectedFramework || value === selectedFramework,
      )) {
        const database = "native_" + id + "_" + provider;
        await admin.query("CREATE DATABASE " + database);
        const config = configs[provider],
          url = `${provider}://${config.user}:${password}@127.0.0.1:${config.port}/${database}`;
        const env = {
          DB_PROVIDER: provider,
          DATABASE_URL: url,
          JWT_SECRET: "isolated-native-jwt-fixture-secret-0000000000",
          ADMIN_EMAIL: "admin@example.test",
          ADMIN_PASSWORD: "Isolated-native-password-45",
          NODE_ENV: "test",
          RATE_LIMIT_AUTH_MAX: "10000",
          RATE_LIMIT_PUBLIC_MAX: "10000",
          RATE_LIMIT_INTERNAL_MAX: "10000",
          CACHE_ENABLED: "false",
          SMTP_ENABLED: "false",
          RATE_LIMIT_STORE: "memory",
          ENDPOINT_POLICIES_JSON: "{}",
          REDIS_URL: `redis://127.0.0.1:${redisPort}`,
          UPLOAD_STORAGE: "local",
          S3_ENDPOINT: `http://127.0.0.1:${s3Port}`,
          S3_REGION: "us-east-1",
          S3_BUCKET: "uploads",
          S3_ACCESS_KEY_ID: "fixture",
          S3_SECRET_ACCESS_KEY: "fixture-secret",
          S3_ACCESS_KEY: "fixture",
          S3_SECRET_KEY: "fixture-secret",
          OTEL_ENABLED: "false",
        };
        const cwd = join(root, folder);
        if (id === "express" || id === "nestjs") {
          if (id === "express" && provider === "postgresql") {
            run(process.execPath, ["scripts/test-migrations.mjs"], cwd, {
              ...env,
              CI: "true",
              PG_TEST_ADMIN_URL: `postgresql://fixture:${password}@127.0.0.1:${postgres}/postgres`,
            });
          }
          run("npm", ["run", "build"], cwd, env);
          run("npm", ["run", "prisma:migrate:deploy"], cwd, env);
          run("npm", ["run", "seed"], cwd, env);
          run("npm", ["run", "test:database"], cwd, env);
          if (id === "nestjs") {
            run("npm", ["run", "test:redis"], cwd, env);
            run("npm", ["run", "test:s3"], cwd, env);
          }
        } else if (id === "dotnet") {
          const native =
            provider === "mysql"
              ? `Server=127.0.0.1;Port=${config.port};Database=${database};User ID=root;Password=${password};SslMode=Preferred`
              : `Host=127.0.0.1;Port=${config.port};Database=${database};Username=fixture;Password=${password}`;
          run(
            "dotnet",
            [
              "test",
              "tests/ModularBackend.IntegrationTests",
              "-c",
              "Release",
              "--no-restore",
            ],
            cwd,
            {
              Database__Provider: provider,
              Database__ConnectionString: native,
              Redis__ConnectionString: `127.0.0.1:${redisPort}`,
              Upload__Endpoint: `http://127.0.0.1:${s3Port}`,
              Upload__Bucket: "uploads",
              Upload__AccessKey: "fixture",
              Upload__SecretKey: "fixture-secret",
            },
          );
        } else {
          run("uv", ["run", "--locked", "backend", "migrate"], cwd, env);
          run(
            "uv",
            ["run", "--locked", "pytest", "tests/integration", "-q"],
            cwd,
            { ...env, TEST_DB_PROVIDER: provider, TEST_DATABASE_URL: url },
          );
        }
        console.log(`${id}/${provider}: native database suite passed`);
      }
    } finally {
      await admin.end();
    }
  }
  const goURL = `postgresql://fixture:${password}@127.0.0.1:${postgres}/fixture`;
  const mysqlURL = `mysql://root:${password}@127.0.0.1:${mysqlPort}/fixture`;
  if (!selectedFramework || selectedFramework === "golang") {
    run(
      "go",
      ["test", "-p", "1", "./...", "-count=1"],
      join(root, "modular-golang"),
      {
        DATABASE_URL: goURL,
        MYSQL_TEST_ADMIN_URL: mysqlURL,
        REDIS_URL: `redis://127.0.0.1:${redisPort}`,
        GOMAXPROCS: "2",
        GOMEMLIMIT: "512MiB",
      },
    );
    console.log(
      "Go: native PostgreSQL HTTP/DB and MySQL port/upgrade suites passed",
    );
  }
} finally {
  for (const name of containers)
    command("docker", ["rm", "-f", "-v", name], root);
}
