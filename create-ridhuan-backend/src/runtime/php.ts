import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export interface PhpCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

function locations(name: string): readonly string[] {
  const found = spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true, shell: false });
  if (found.error || found.status !== 0) throw new Error(`${name} was not found on PATH`);
  return found.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function phpExecutable(): string {
  const override = process.env.RIDHUAN_PHP_BINARY;
  if (override !== undefined) {
    if (!isAbsolute(override) || !existsSync(override) || process.platform === "win32" && !override.toLowerCase().endsWith(".exe")) {
      throw new Error("RIDHUAN_PHP_BINARY must identify an existing absolute PHP executable");
    }
    return override;
  }
  if (process.platform !== "win32") return "php";
  for (const file of locations("php")) {
    if (/\.exe$/i.test(file)) return file;
    if (/\.(bat|cmd)$/i.test(file)) {
      const body = readFileSync(file, "utf8");
      // Laravel Herd's documented launcher delegates to one absolute PHP executable.
      const match = /^"([^"\r\n]+\\php\.exe)"\s+%\*\s*$/im.exec(body);
      const executable = match?.[1];
      if (executable && isAbsolute(executable) && existsSync(executable)) return executable;
    }
  }
  throw new Error("Cannot resolve PHP launcher to php.exe; set RIDHUAN_PHP_BINARY to its absolute path");
}

export function phpCommand(commandName: "php" | "composer", args: readonly string[], cwd: string): PhpCommand {
  if (!isAbsolute(cwd) || !existsSync(cwd)) throw new Error("PHP working directory must exist and be absolute");
  if (commandName === "php") return { executable: phpExecutable(), args };
  const override = process.env.RIDHUAN_COMPOSER_PHAR;
  if (override !== undefined) {
    if (!isAbsolute(override) || !override.toLowerCase().endsWith(".phar") || !existsSync(override)) {
      throw new Error("RIDHUAN_COMPOSER_PHAR must identify an existing absolute Composer PHAR");
    }
    return { executable: phpExecutable(), args: [override, ...args] };
  }
  if (process.platform !== "win32") return { executable: "composer", args };
  for (const file of locations("composer")) {
    if (/\.exe$/i.test(file)) return { executable: file, args };
    if (/\.(bat|cmd)$/i.test(file)) {
      const body = readFileSync(file, "utf8");
      const phar = join(dirname(file), "composer.phar");
      // Exact launcher emitted by the pinned setup-php add_tools.ps1; its
      // Edit-ComposerConfig creates the adjacent composer.phar copy.
      const setupPhpLauncher = body.replace(/^\uFEFF/, "").trim().replaceAll("\r\n", "\n") === "@ECHO off\nsetlocal DISABLEDELAYEDEXPANSION\nSET BIN_TARGET=%~dp0/composer\nphp %BIN_TARGET% %*";
      if ((/^php\s+"%~dp0composer\.phar"\s+%\*\s*$/im.test(body) || setupPhpLauncher) && existsSync(phar)) {
        return { executable: phpExecutable(), args: [phar, ...args] };
      }
    }
  }
  throw new Error("Cannot resolve Composer launcher to PHAR; set RIDHUAN_COMPOSER_PHAR to its absolute path");
}
