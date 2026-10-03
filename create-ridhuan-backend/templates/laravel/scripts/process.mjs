import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';

const active = new Set();
let cancelled = false;
export const interrupted = () => cancelled;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  cancelled = true;
  for (const child of active) stop(child);
});

export function executable(name, args) {
  if (name === 'php' && process.env.RIDHUAN_PHP_BINARY) return [process.env.RIDHUAN_PHP_BINARY, args];
  if (name === 'composer' && process.env.RIDHUAN_COMPOSER_PHAR) return executable('php', [process.env.RIDHUAN_COMPOSER_PHAR, ...args]);
  if (process.platform !== 'win32' || !['php', 'composer'].includes(name)) return [name, args];
  const found = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  if (found.status !== 0) throw new Error(`Missing ${name}`);
  for (const path of found.stdout.trim().split(/\r?\n/)) {
    if (/\.exe$/i.test(path)) return [path, args];
    const body = readFileSync(path, 'utf8');
    if (name === 'php') {
      const native = /^"([^"\r\n]+\\php\.exe)"\s+%\*\s*$/im.exec(body)?.[1];
      if (native && existsSync(native)) return [native, args];
    } else {
      const phar = join(dirname(path), 'composer.phar');
      // setup-php's pinned add_tools.ps1 writes this four-line Windows launcher
      // and Edit-ComposerConfig copies its downloaded tool to composer.phar.
      const setupPhpLauncher = body.replace(/^\uFEFF/, '').trim().replaceAll('\r\n', '\n') === '@ECHO off\nsetlocal DISABLEDELAYEDEXPANSION\nSET BIN_TARGET=%~dp0/composer\nphp %BIN_TARGET% %*';
      if ((/^php\s+"%~dp0composer\.phar"\s+%\*\s*$/im.test(body) || setupPhpLauncher) && existsSync(phar)) return executable('php', [phar, ...args]);
    }
  }
  throw new Error(`Unsupported ${name} launcher`);
}

export function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const escalation = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 5000);
    escalation.unref();
  }
}

export async function collect(name, args, cwd, log, env = {}, timeoutMs = 600000) {
  let command;
  try { command = executable(name, args); } catch (error) { return { exitCode: null, error: error.message }; }
  const output = createWriteStream(log);
  let outputError;
  let running;
  output.on('error', (error) => { outputError = error.message; if (running) stop(running); });
  const opened = await new Promise((resolve) => { output.once('open', () => resolve(true)); output.once('error', () => resolve(false)); });
  if (!opened) return { exitCode: null, error: outputError };
  const result = await new Promise((resolve) => {
    const child = spawn(command[0], command[1], { cwd, env: { ...process.env, ...env }, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(child);
    running = child;
    let timeout = false;
    const timer = setTimeout(() => { timeout = true; stop(child); }, timeoutMs);
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    child.once('error', (error) => { active.delete(child); clearTimeout(timer); resolve({ exitCode: null, error: error.message }); });
    child.once('close', (exitCode, signal) => { active.delete(child); clearTimeout(timer); resolve({ exitCode: timeout ? 124 : cancelled ? 130 : exitCode, signal, timeout }); });
  });
  if (!output.destroyed) await new Promise((resolve) => { output.once('error', resolve); output.end(resolve); });
  return outputError ? { ...result, error: outputError } : result;
}
