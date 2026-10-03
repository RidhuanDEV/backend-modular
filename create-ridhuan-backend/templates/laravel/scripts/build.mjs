import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { collect, interrupted } from './process.mjs';
const root = resolve(import.meta.dirname, '..'), logs = await mkdtemp(join(tmpdir(), 'laravel-build-'));
const fixture = 'laravel-build-' + randomUUID().slice(0, 8), results = [];
const configOverride = join(logs, 'compose-without-runtime-env.yaml');
await writeFile(configOverride, 'services:\n' + ['app', 'migrate', 'worker', 'seeder'].map((service) => `  ${service}:\n    env_file: !reset []\n`).join(''));
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]?.split(',') : null;
const jobs = [
  ['locked-install', 'composer', ['install', '--no-interaction', '--prefer-dist']],
  ['autoload-discovery-artifacts', 'composer', ['build']],
  ['docker-app', 'docker', ['build', '--target', 'app', '-t', fixture + ':app', '.']],
  ['docker-web', 'docker', ['build', '--target', 'web', '-t', fixture + ':web', '.']],
  ['compose-postgresql-config', 'docker', ['compose', '--env-file', '.env.example', '-f', 'compose.yaml', '-f', configOverride, 'config', '--quiet']],
  ['compose-mysql-config', 'docker', ['compose', '--env-file', '.env.mysql.example', '-f', 'compose.mysql.yaml', '-f', configOverride, 'config', '--quiet']],
];
if (only && (!only.length || only.some((id) => !jobs.some(([known]) => known === id)))) throw new Error('Unknown or empty selected build gate');
await writeFile(join(logs, 'inventory.json'), JSON.stringify({ stage: 'full-build-package-only', jobs }, null, 2));
try {
  for (const [id, name, args] of jobs) { if (only && !only.includes(id)) continue; if (interrupted()) { results.push({ id, exitCode: 1, error: 'Interrupted' }); continue; } const result = await collect(name, args, root, join(logs, id + '.log'), { POSTGRES_PASSWORD: 'BuildOnlyFixture123', MYSQL_PASSWORD: 'BuildOnlyFixture123', MYSQL_ROOT_PASSWORD: 'BuildOnlyFixtureRoot123', COMPOSE_DISABLE_ENV_FILE: 'true' }, 1800000); results.push({ id, ...result }); console.log(`${id}: ${result.exitCode === 0 && !result.error ? 'PASSED' : 'FAILED'}`); }
} finally {
  for (const tag of [fixture + ':app', fixture + ':web']) {
    const inspect = spawnSync('docker', ['image', 'inspect', tag], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (inspect.status === 0) { const cleanup = await collect('docker', ['image', 'rm', tag], root, join(logs, tag.split(':')[1] + '-cleanup.log'), {}, 30000); results.push({ id: tag + '-cleanup', ...cleanup }); }
    const remaining = spawnSync('docker', ['image', 'inspect', tag], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (remaining.status === 0) results.push({ id: tag + '-remaining', exitCode: 1 });
  }
  await writeFile(join(logs, 'results.json'), JSON.stringify(results, null, 2));
}
const failed = results.some((r) => r.exitCode !== 0 || r.error); console.log(`Full build/package: ${failed ? 'FAILED' : 'PASSED'}; ${logs}`); process.exitCode = failed ? 1 : 0;
