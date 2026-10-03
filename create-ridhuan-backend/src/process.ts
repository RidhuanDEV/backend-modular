import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { phpCommand } from "./runtime/php.js";
import semver from "semver";
import type { ProjectAnswers, TemplateManifest } from "./types.js";
import { templateRegistry } from "./templates.js";

function npmExecutable(): string {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")];
  if (process.platform === "win32") {
    const located = spawnSync("where.exe", ["npm"], { encoding: "utf8", windowsHide: true });
    for (const location of (located.stdout ?? "").trim().split(/\r?\n/)) {
      candidates.push(join(dirname(location), "node_modules", "npm", "bin", "npm-cli.js"));
    }
  } else {
    for (const path of (process.env.PATH ?? "").split(":")) candidates.push(join(path, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  }
  for (const file of candidates) {
    if (file && /npm-cli\.js$/.test(file) && existsSync(file)) return file;
  }
  throw new Error("npm executable not found. Install Node.js with npm before continuing.");
}

function mavenCommand(args: readonly string[], cwd: string): { executable: string; args: readonly string[] } {
  const wrapper = resolve(cwd, process.platform === "win32" ? "mvnw.cmd" : "mvnw");
  if (!isAbsolute(cwd) || !existsSync(wrapper)) throw new Error("Maven Wrapper requires an absolute project directory");
  if (process.platform !== "win32") return { executable: "/bin/sh", args: [wrapper, ...args] };
  const quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'";
  const script = "& " + quote(wrapper) + " " + args.map(quote).join(" ") + "; exit $LASTEXITCODE";
  return { executable: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")] };
}

export function command(commandName: string, args: readonly string[], cwd: string, inherit = false, environment: Readonly<Record<string, string>> = {}): SpawnSyncReturns<string> {
  const native = commandName === "php" || commandName === "composer" ? phpCommand(commandName, args, cwd) : commandName === "mvnw" ? mavenCommand(args, cwd) : undefined;
  const executable = native?.executable ?? (commandName === "npm" ? process.execPath : commandName);
  const argumentsList = native ? [...native.args] : commandName === "npm" ? [npmExecutable(), ...args] : [...args];
  return spawnSync(executable, argumentsList, { cwd, encoding: "utf8", stdio: inherit ? "inherit" : "pipe",
    shell: false, windowsHide: true, timeout: 30 * 60 * 1000, env: { ...process.env, ...environment, ...(commandName === "go" ? { GOWORK: "off" } : {}) } });
}

export function preflight(answers: ProjectAnswers, manifest: TemplateManifest): void {
  if (answers.mode === "docker") {
    for (const args of [["version", "--format", "{{.Server.Version}}"], ["compose", "version", "--short"]]) {
      const result = command("docker", args, process.cwd());
      if (result.status !== 0 || result.error) throw new Error("Docker Engine and Compose v2 are required. Start Docker or use --no-install to generate files first.");
      if (args[0] === "compose" && !semver.gte(semver.coerce(result.stdout)?.version ?? "0.0.0", "2.24.4")) throw new Error("Docker Compose 2.24.4 or newer is required for optional services and port overrides.");
    }
    return;
  }
  if (manifest.requirements.node && !semver.satisfies(process.versions.node, manifest.requirements.node)) {
    throw new Error(`${templateRegistry[answers.templateId].label} requires Node ${manifest.requirements.node}; current version is ${process.versions.node}. Use a supported Node version or --mode docker.`);
  }
  if (manifest.requirements.java) {
    const result = command("java", ["-version"], process.cwd());
    const version = /version "(\d+)(?:\.[^"]*)?"/.exec(result.stderr + result.stdout)?.[1];
    if (result.error || result.status !== 0 || version !== manifest.requirements.java) throw new Error(`JDK ${manifest.requirements.java} is required by Spring Boot; use a supported JDK or --mode docker.`);
    const javaHome = process.env["JAVA_HOME"];
    if (javaHome && !isAbsolute(javaHome)) throw new Error("JAVA_HOME must name an absolute JDK directory");
    const suffix = process.platform === "win32" ? ".exe" : "";
    const compiler = command(javaHome ? join(javaHome, "bin", "javac" + suffix) : "javac", ["-version"], process.cwd());
    const wrapperRuntime = javaHome ? command(join(javaHome, "bin", "java" + suffix), ["-version"], process.cwd()) : result;
    const compilerVersion = /javac (\d+)(?:\.[^\s]*)?/.exec(compiler.stderr + compiler.stdout)?.[1];
    const wrapperVersion = /version "(\d+)(?:\.[^"]*)?"/.exec(wrapperRuntime.stderr + wrapperRuntime.stdout)?.[1];
    if (compiler.error || compiler.status !== 0 || wrapperRuntime.error || wrapperRuntime.status !== 0 || compilerVersion !== manifest.requirements.java || wrapperVersion !== manifest.requirements.java) throw new Error(`Maven Wrapper requires a complete JDK ${manifest.requirements.java}; check JAVA_HOME and javac.`);
    if (!manifest.requirements.maven || !/^3\.9\.\d+$/.test(manifest.requirements.maven)) throw new Error("Invalid Maven Wrapper requirement");
    if (process.platform !== "win32" && command("unzip", ["-v"], process.cwd()).status !== 0) throw new Error("Install unzip for the checksum-pinned Maven Wrapper before generation.");
    return;
  }
  if (manifest.requirements.php) {
    const result = command("php", ["-r", "echo json_encode([PHP_VERSION, PHP_INT_SIZE, get_loaded_extensions()]);"], process.cwd());
    if (result.status !== 0 || result.error) throw new Error("PHP is missing; install the required runtime or use Docker.");
    const value: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(value) || typeof value[0] !== "string" || value[1] !== 8 || !Array.isArray(value[2]) || !semver.satisfies(value[0], manifest.requirements.php)) throw new Error(`64-bit PHP ${manifest.requirements.php} is required.`);
    const extensions = new Set(value[2].filter((extension: unknown): extension is string => typeof extension === "string").map(extension => extension.toLowerCase()));
    for (const extension of [...(manifest.requirements.phpExtensions ?? []), answers.databaseProvider === "mysql" ? "pdo_mysql" : "pdo_pgsql"]) if (!extensions.has(extension)) throw new Error(`PHP extension ${extension} is required.`);
    const composer = command("composer", ["--version", "--no-ansi"], process.cwd());
    const version = /Composer version (\d+\.\d+\.\d+)/.exec(composer.stdout)?.[1];
    if (composer.status !== 0 || composer.error || !version || !semver.satisfies(version, manifest.requirements.composer ?? ">=2.9.8")) throw new Error("Required Composer runtime is unavailable.");
    return;
  }
  if (manifest.requirements.python) {
    const version = command("uv", ["--version"], process.cwd());
    if (version.status !== 0 || version.error || !semver.gte(semver.coerce(version.stdout)?.version ?? "0.0.0", manifest.requirements.uv ?? "0.12.21")) throw new Error(`FastAPI requires uv ${manifest.requirements.uv ?? "0.12.21"} or newer. Install it or use --mode docker.`);
    const python = command("uv", ["python", "find", "--system", "--no-python-downloads", manifest.requirements.python], process.cwd());
    if (python.status !== 0 || python.error) throw new Error(`Python ${manifest.requirements.python} is required. Install it before setup, or use --mode docker.`);
    return;
  }
  const requirement = manifest.requirements.go ?? manifest.requirements.dotnet;
  const executable = manifest.requirements.go ? "go" : manifest.requirements.dotnet ? "dotnet" : "npm";
  const goPolicy = executable === "go" ? (command("go", ["env", "GOTOOLCHAIN"], process.cwd()).stdout ?? "").trim() : "";
  const toolchain = executable === "go" && requirement && goPolicy.endsWith("auto") ? { GOTOOLCHAIN: `go${requirement}` } : {};
  const result = command(executable, executable === "go" ? ["version"] : executable === "dotnet" ? ["--list-sdks"] : ["--version"], process.cwd(), false, toolchain);
  if (result.error || result.status !== 0) throw new Error(`${executable} is missing. Install the required tool or use --mode docker.`);
  if (requirement) {
    const compatible = executable === "go"
      ? semver.gte(/go(\d+\.\d+\.\d+)/.exec(result.stdout)?.[1] ?? "0.0.0", requirement)
      : result.stdout.split(/\r?\n/).some((line) => line.startsWith(`${requirement} `));
    if (!compatible) throw new Error(`${executable} ${requirement} is required by this template.`);
  }
  if (executable === "dotnet") {
    const loader = process.platform === "win32" ? "pwsh" : "python3";
    if (command(loader, ["--version"], process.cwd()).status !== 0) throw new Error(`${loader} is required for the .NET env loader. Install it or use --mode docker.`);
  }
}

export function installDependencies(answers: ProjectAnswers): void {
  if (answers.mode === "docker") return;
  const install = templateRegistry[answers.templateId].install;
  const args = answers.templateId === "fastapi" ? [...install.args, "--extra", answers.databaseProvider] : install.args;
  const environment = answers.templateId === "dotnet" ? { Database__Provider: answers.databaseProvider } : { DB_PROVIDER: answers.databaseProvider };
  const result = command(install.command, args, answers.targetDirectory, true, environment);
  if (result.error || result.status !== 0) {
    throw new Error(`Dependency installation failed. Project files and secrets are preserved. In the project directory run: ${install.command} ${args.join(" ")}. See GETTING-STARTED.md for remaining steps.`);
  }
}
