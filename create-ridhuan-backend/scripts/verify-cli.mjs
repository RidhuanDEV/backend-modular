import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve, sep } from "node:path";
import { command } from "../dist/process.js";
import {
  parseCliArgs,
  parsePort,
  validateProjectName,
  validateGoModule,
} from "../dist/arguments.js";
import { serializeEnvValue } from "../dist/scaffold/env.js";
const root = resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(join(tmpdir(), "ridhuan consumer with spaces-"));
const keep = process.argv.includes("--keep");
function run(name, args, cwd = scratch, expected = 0) {
  const result = command(name, args, cwd);
  assert.equal(
    result.status,
    expected,
    `${name} failed: ${result.stderr || result.stdout}`,
  );
  return result.stdout;
}
try {
  const asset = process.env.CLI_TARBALL;
  const pack = asset
    ? undefined
    : JSON.parse(
        run(
          "npm",
          ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
          root,
        ),
      )[0];
  if (pack) {
    const paths = pack.files.map((file) => file.path);
    assert(paths.includes("dist/bin/index.js"));
    assert(
      !paths.some((path) =>
        /(^|\/)(?:\.env|node_modules|\.git|obj|\.venv|__pycache__)(\/|$)/.test(
          path,
        ),
      ),
    );
    for (const id of [
      "express-typescript",
      "nestjs",
      "golang",
      "dotnet",
      "fastapi",
    ])
      for (const file of [
        "gitignore.template",
        "LICENSE",
        "template-manifest.json",
      ])
        assert(paths.includes(`templates/${id}/${file}`));
    assert(
      paths.includes(
        "templates/dotnet/tools/ModularBackend.Migrator/ModularBackend.Migrator.csproj",
      ),
    );
  }
  const tarball = asset ? resolve(asset) : join(scratch, pack.filename);
  await writeFile(
    join(scratch, "package.json"),
    '{"name":"consumer-verification","private":true}\n',
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ]);
  const installed = join(scratch, "node_modules/create-ridhuan-backend");
  const privateValues = [];
  for (const repository of [
    "modular-express-typescript-starter-postgre",
    "nestjs",
    "modular-golang",
    "modular-NET",
    "modular-fastapi",
  ]) {
    let localEnv;
    try {
      localEnv = await readFile(join(root, "..", repository, ".env"), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
    for (const line of localEnv.split(/\r?\n/)) {
      const split = line.indexOf("=");
      if (
        split < 1 ||
        !/SECRET|PASSWORD|TOKEN/i.test(line.slice(0, split)) ||
        line.trimStart().startsWith("#")
      )
        continue;
      let value = line.slice(split + 1).trim();
      if (value.startsWith('"') && value.endsWith('"'))
        value = JSON.parse(value.replaceAll("\\$", "$"));
      else if (value.startsWith("'") && value.endsWith("'"))
        value = value.slice(1, -1).replaceAll("\\'", "'");
      if (
        value.length >= 12 &&
        !/change_this|replace|example|change_me|fixture|development|your[_-]/i.test(
          value,
        )
      )
        privateValues.push(value);
    }
  }
  const checkPrivateValues = (content) => {
    for (const value of privateValues)
      assert(
        !content.includes(value),
        "Local private credential in installed tarball",
      );
  };
  for (const file of ["package.json", "README.md", "LICENSE"])
    checkPrivateValues(await readFile(join(installed, file), "utf8"));
  let snapshotFiles = 0;
  for (const id of [
    "express-typescript",
    "nestjs",
    "golang",
    "dotnet",
    "fastapi",
  ]) {
    const template = join(installed, "templates", id);
    const manifest = JSON.parse(
      await readFile(join(template, "template-manifest.json"), "utf8"),
    );
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.id, id);
    const files = [];
    async function inventory(directory, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        assert(!entry.isSymbolicLink(), "Snapshot contains a symbolic link");
        const path = prefix + entry.name;
        if (entry.isDirectory())
          await inventory(join(directory, entry.name), path + "/");
        else if (path !== "template-manifest.json") files.push(path);
      }
    }
    await inventory(template);
    assert.deepEqual(
      files.sort(),
      Object.keys(manifest.files).sort(),
      "Snapshot inventory differs from its manifest",
    );
    for (const file of files) {
      assert(
        !/(^|\/)(?:\.env|node_modules|\.git|obj|\.venv|__pycache__|\.pytest_cache)(\/|$)/.test(
          file,
        ),
        "Local artifact in snapshot",
      );
      assert(
        !/^(?:uploads|bin|artifacts|\.tmp)\//.test(file),
        "Runtime artifact in snapshot",
      );
      const content = await readFile(join(template, file));
      checkPrivateValues(content.toString("utf8"));
      assert.equal(
        createHash("sha256").update(content).digest("hex"),
        manifest.files[file],
        `${id}/${file} checksum mismatch`,
      );
      assert(
        !/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(
          content.toString("utf8"),
        ),
        "Private key in snapshot",
      );
      snapshotFiles++;
    }
  }
  console.log(
    `Installed tarball inventory, ${snapshotFiles} snapshot checksums, ${privateValues.length} private-value checks and local/private-key exclusion passed`,
  );
  const executable = join(
    scratch,
    "node_modules/create-ridhuan-backend/dist/bin/index.js",
  );
  for (const database of ["postgresql", "mysql"]) {
    for (const [option, maximum] of [
      ["--db-user", database === "mysql" ? 32 : 63],
      ["--db-name", database === "mysql" ? 64 : 63],
    ]) {
      const name = `boundary-${database}-${option.slice(2)}`;
      run(process.execPath, [
        executable,
        name,
        "--database",
        database,
        option,
        "a".repeat(maximum),
        "--yes",
        "--no-install",
      ]);
      const rejected = name + "-invalid";
      const result = command(process.execPath, [
        executable,
        rejected,
        "--database",
        database,
        option,
        "a".repeat(maximum + 1),
        "--yes",
      ]);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`${database}.*maximum ${maximum}`),
      );
      assert(
        !(await readdir(scratch)).includes(rejected),
        "Invalid identifier created a project folder",
      );
    }
  }
  assert.match(
    run(process.execPath, [executable, "--help"]),
    /npm create.+ -- /,
  );
  assert.match(
    run(process.execPath, [executable, "--version"]),
    /^\d+\.\d+\.\d+/,
  );
  const promptModule = pathToFileURL(
    join(scratch, "node_modules/create-ridhuan-backend/dist/prompts/select.js"),
  ).href;
  const cancellation = command(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { selectPrompt } from ${JSON.stringify(promptModule)};Object.defineProperty(process.stdin,'isTTY',{value:true});process.stdin.setRawMode=()=>process.stdin;selectPrompt('Cancel fixture',[{label:'Continue',value:true}]);process.stdin.emit('data',Buffer.from([3]));`,
    ],
    scratch,
  );
  assert.equal(cancellation.status, 130);
  assert.match(cancellation.stdout, /Aborted/);

  for (const args of [
    ["--database", "sqlite"],
    ["--template", "unknown"],
    ["--port", "3000bad"],
    ["--port", "65536"],
    ["--unknown"],
    ["../escape"],
    ["CON"],
    ["bad", "--template", "go", "--go-module", "../bad"],
  ])
    assert.notEqual(
      command(
        process.execPath,
        [executable, ...args, "--yes", "--no-install"],
        scratch,
      ).status,
      0,
    );
  assert.throws(() => parsePort("3.14", "port"));
  assert.throws(() => validateProjectName("bad."));
  assert.throws(() => validateGoModule("foo/../bar"));
  assert.throws(() => parseCliArgs(["--redis", "--no-redis"]));
  assert.throws(() => serializeEnvValue("line\nbreak"));
  const baseFixtures = [
    ["express-typescript", "Custom.Express", 3000],
    ["nestjs", "Custom.Nest", 3000],
    ["golang", "custom-go", 8080],
    ["dotnet", "Custom.Net", 5080],
    ["fastapi", "custom-fastapi", 8000],
  ];
  const fixtures = baseFixtures.flatMap(([id, name, port]) =>
    ["postgresql", "mysql"].map((database) => [
      id,
      database === "mysql" ? name + "-mysql" : name,
      port,
      database,
    ]),
  );
  for (const [id, name, port, database] of fixtures) {
    run(process.execPath, [
      executable,
      name,
      "--template",
      id,
      "--database",
      database,
      "--yes",
      "--no-install",
    ]);
    const project = join(scratch, name),
      env = await readFile(join(project, ".env"), "utf8");
    assert.match(env, new RegExp(`^APP_PORT=${port}$`, "m"));
    assert.match(
      env,
      new RegExp(
        `^${id === "dotnet" ? "Database__Provider" : "DB_PROVIDER"}=${database}$`,
        "m",
      ),
    );
    const marker = JSON.parse(
      await readFile(join(project, "backend-template.json"), "utf8"),
    );
    assert.equal(marker.databaseProvider, database);
    const compose = await readFile(
      join(
        project,
        id === "express-typescript" ? "docker-compose.yml" : "compose.yaml",
      ),
      "utf8",
    );
    assert.match(
      compose,
      new RegExp(`^  ${database === "mysql" ? "mysql" : "postgres"}:`, "m"),
    );
    if (database === "mysql") {
      assert.match(env, /^MYSQL_PORT=3306$/m);
      assert(!/^POSTGRES_PORT=/m.test(env));
    }
    if (id === "fastapi") {
      assert.match(
        await readFile(join(project, "pyproject.toml"), "utf8"),
        new RegExp(`name = "${name}"`),
      );
      assert.match(
        await readFile(join(project, "uv.lock"), "utf8"),
        new RegExp(`name = "${name}"`),
      );
    }
    if (id !== "dotnet") assert.match(env, new RegExp(`^PORT=${port}$`, "m"));
    assert.equal(run("git", ["check-ignore", ".env"], project).trim(), ".env");
    assert(!run("git", ["add", "--dry-run", "."], project).includes("'.env'"));
    const files = await readdir(project);
    assert(!files.includes("gitignore.template"));
    assert(!files.includes("node_modules"));
    const guide = await readFile(join(project, "GETTING-STARTED.md"), "utf8");
    assert.match(guide, /migrat/i);
    assert.match(guide, new RegExp(`localhost:${port}`));
    if (["nestjs", "express-typescript"].includes(id)) {
      const pkg = JSON.parse(
          await readFile(join(project, "package.json"), "utf8"),
        ),
        lock = JSON.parse(
          await readFile(join(project, "package-lock.json"), "utf8"),
        );
      assert.equal(pkg.name, lock.name);
      assert.equal(pkg.name, lock.packages[""].name);
      assert.match(
        pkg.scripts.prebuild ?? pkg.scripts.build,
        /prisma.*generate/,
      );
      assert(!pkg.scripts["verify:template"].includes("verify-package"));
    }
    assert.notEqual(
      command(
        process.execPath,
        [executable, name, "--yes", "--no-install"],
        scratch,
      ).status,
      0,
    );
    assert.equal(await readFile(join(project, ".env"), "utf8"), env);
    console.log(
      `${id}/${database}: tarball generation, defaults, lockfiles and secret ignore passed`,
    );
  }
  for (const [id, , , database] of fixtures) {
    run("npm", [
      "exec",
      "--offline",
      "--",
      "create-ridhuan-backend",
      `exec-${id}-${database}`,
      "--template",
      id,
      "--database",
      database,
      "--yes",
      "--no-install",
    ]);
    run("npm", [
      "create",
      "ridhuan-backend",
      `create-${id}-${database}`,
      "--offline",
      "--",
      "--template",
      id,
      "--database",
      database,
      "--yes",
      "--no-install",
    ]);
  }
  const missingTool = command(
    process.execPath,
    [executable, "missing-tool", "--template", "go", "--yes"],
    scratch,
    false,
    { PATH: "" },
  );
  assert.notEqual(missingTool.status, 0);
  assert.match(missingTool.stderr, /go is missing/);
  assert(!(await readdir(scratch)).includes("missing-tool"));
  const failedInstaller = join(scratch, "npm-cli.js");
  await writeFile(
    failedInstaller,
    `if(process.argv.includes('--version'))console.log('11.16.0');else process.exit(42);`,
  );
  const failedInstall = command(
    process.execPath,
    [executable, "retry-project", "--template", "express", "--yes"],
    scratch,
    false,
    { npm_execpath: failedInstaller },
  );
  assert.notEqual(failedInstall.status, 0);
  assert.match(failedInstall.stderr, /files and secrets are preserved/);
  assert.equal(
    run("git", ["check-ignore", ".env"], join(scratch, "retry-project")).trim(),
    ".env",
  );
  await symlink(
    join(scratch, "custom-go"),
    join(scratch, "linked-project"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.notEqual(
    command(
      process.execPath,
      [executable, "linked-project", "--yes", "--no-install"],
      scratch,
    ).status,
    0,
  );
  run(process.execPath, [
    executable,
    "custom-options",
    "--template",
    "go",
    "--port",
    "4567",
    "--redis",
    "--storage",
    "s3",
    "--go-module",
    "example.org/team/custom-api",
    "--yes",
    "--no-install",
  ]);
  const custom = await readFile(join(scratch, "custom-options/.env"), "utf8");
  assert.match(custom, /^PORT=4567$/m);
  assert.match(custom, /^COMPOSE_PROFILES=redis,minio$/m);
  assert.match(
    await readFile(join(scratch, "custom-options/go.mod"), "utf8"),
    /^module example.org\/team\/custom-api/m,
  );
  const provider = [
    "provider-net",
    "--template",
    "dotnet",
    "--port",
    "54321",
    "--storage",
    "s3",
    "--s3-endpoint",
    "https://objects.example.test",
    "--s3-region",
    "ap-southeast-3",
    "--s3-access-key",
    "custom-access",
    "--s3-bucket",
    "custom-bucket",
    "--yes",
    "--no-install",
  ];
  run(process.execPath, [executable, ...provider]);
  const providerEnv = await readFile(
    join(scratch, "provider-net/.env"),
    "utf8",
  );
  assert.match(
    providerEnv,
    /^S3_ENDPOINT_DOCKER=https:\/\/objects.example.test$/m,
  );
  assert.match(providerEnv, /^Upload__Region=ap-southeast-3$/m);
  assert.match(providerEnv, /^Upload__AccessKey=custom-access$/m);
  assert.match(providerEnv, /^COMPOSE_PROFILES=$/m);
  assert.match(
    await readFile(
      join(
        scratch,
        "provider-net/src/ProviderNet.Api/Properties/launchSettings.json",
      ),
      "utf8",
    ),
    /54321/,
  );
  console.log(
    "Invalid input, overwrite, missing tool, install recovery, custom provider, npm exec and npm create passed",
  );
  if (keep) console.log(`Consumer fixture: ${scratch}`);
} finally {
  if (!keep) {
    if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep))
      throw new Error("Invalid test cleanup path");
    await rm(scratch, { recursive: true, force: true });
  }
}
