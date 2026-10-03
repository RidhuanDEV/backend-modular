import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { collect, interrupted } from './process.mjs';

const root = resolve(import.meta.dirname, '..');
const stage = process.argv.includes('--stage') ? process.argv[process.argv.indexOf('--stage') + 1] : 'native';
if (!['native', 'integration'].includes(stage)) throw new Error('Choose native or integration');
const logs = await mkdtemp(join(tmpdir(), `laravel-${stage}-logs-`));
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]?.split(',') : null;
const native = [
  ['platform', 'php', ['tests/Fixtures/runtime.php', 'platform']],
  ['composer-validate', 'composer', ['validate', '--strict']],
  ['composer-audit', 'composer', ['audit', '--locked', '--no-interaction']],
  ['pint', 'php', ['vendor/bin/pint', '--test', '--cache-file', join(logs, 'pint-cache.json')]],
  ['larastan', 'php', ['vendor/bin/phpstan', 'analyse', '--memory-limit=1G', '--no-progress']],
  ['unit', 'php', ['vendor/bin/phpunit', '--testsuite', 'Unit', '--log-junit', join(logs, 'unit.xml')]],
  ['native-cache', 'php', ['tests/Fixtures/cache.php', logs]],
];
const integration = ['postgresql', 'mysql'].flatMap((provider) => [['contracts', 'infrastructure', 'process'].map((suite) => [`${provider}-${suite}`, provider, suite])]).flat();
const ids = (stage === 'native' ? native : integration).map(([id]) => id);
if (only && (!only.length || only.some((id) => !ids.includes(id)))) throw new Error('Unknown or empty selected gate');
await writeFile(join(logs, 'inventory.json'), JSON.stringify({ stage, cases: stage === 'native' ? native : integration, timeoutMs: 600000, cleanup: 'owned named Docker containers removed in finally; aggregate failed on any failure' }, null, 2));
const results = [];
const cachePath = (file) => join(logs, file).replaceAll('\\', '/');
const env = { APP_ENV: 'testing', APP_KEY: `base64:${randomBytes(32).toString('base64')}`, JWT_SECRET: randomBytes(48).toString('hex'), ADMIN_PASSWORD: randomBytes(24).toString('hex'), APP_CONFIG_CACHE: cachePath('config.php'), APP_ROUTES_CACHE: cachePath('routes.php'), APP_SERVICES_CACHE: cachePath('services.php'), APP_PACKAGES_CACHE: cachePath('packages.php'), DB_DATABASE: 'laravel_test_native' };
if (stage === 'native') {
  for (const [id, command, args] of native) {
    if (interrupted()) { results.push({ id, exitCode: 1, error: 'Interrupted' }); continue; }
    if (only && !only.includes(id)) continue;
    const result = await collect(command, args, root, join(logs, `${id}.log`), env); results.push({ id, ...result }); console.log(`${id}: ${result.exitCode === 0 && !result.error ? 'PASSED' : 'FAILED'}`);
  }
} else {
  for (const provider of ['postgresql', 'mysql']) {
    if (interrupted()) { results.push({ id: provider, exitCode: 1, error: 'Interrupted' }); continue; }
    if (only && !only.some((id) => id.startsWith(provider + '-'))) continue;
    const name = `laravel-test-${provider}-${randomUUID().slice(0, 8)}`;
    const database = `laravel_test_${randomBytes(5).toString('hex')}`, password = randomBytes(24).toString('hex');
    const image = provider === 'mysql' ? 'mysql:8.4.8' : 'postgres:18.3-alpine';
    const port = provider === 'mysql' ? 3306 : 5432;
    const args = ['run', '-d', '--name', name, '--label', 'ridhuan.laravel.fixture=' + name, '-p', `127.0.0.1::${port}`];
    args.push(...(provider === 'mysql' ? ['-e', `MYSQL_ROOT_PASSWORD=${password}`, '-e', `MYSQL_DATABASE=${database}`, '-e', 'MYSQL_USER=backend', '-e', `MYSQL_PASSWORD=${password}`] : ['-e', `POSTGRES_USER=backend`, '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${database}`]), image);
    try {
      const started = await collect('docker', args, root, join(logs, `${provider}-start.log`), {}, 180000); assert.equal(started.exitCode, 0, 'Owned database fixture failed');
      const deadline = Date.now() + 180000; let ready = false;
      while (Date.now() < deadline && !interrupted()) {
        const check = spawnSync('docker', ['exec', name, ...(provider === 'mysql' ? ['mysqladmin', 'ping', '-h127.0.0.1', '--silent'] : ['pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'backend', '-d', database])], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
        if (check.status === 0) { ready = true; break; } await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      assert(ready, 'Database readiness timeout');
      const mapped = spawnSync('docker', ['port', name, `${port}/tcp`], { encoding: 'utf8', windowsHide: true }); const hostPort = mapped.stdout.trim().split(':').at(-1); assert(/^\d+$/.test(hostPort), 'No fixture host port');
      const dbEnv = { ...env, DB_PROVIDER: provider, DB_HOST: '127.0.0.1', DB_PORT: hostPort, DB_DATABASE: database, DB_USERNAME: 'backend', DB_PASSWORD: password, RIDHUAN_FIXTURE_ADMIN_PASSWORD: password, SMTP_ENABLED: 'false', RATE_LIMIT_STORE: 'file', LARAVEL_STORAGE_PATH: join(logs, provider, 'storage') };
      for (const dir of ['framework/cache/data', 'framework/cache/locks', 'framework/sessions', 'framework/views', 'logs', 'app/private/uploads']) await mkdir(join(dbEnv.LARAVEL_STORAGE_PATH, dir), { recursive: true });
      for (const suite of ['contracts', 'infrastructure', 'process']) {
        const id = `${provider}-${suite}`; if (only && !only.includes(id)) continue;
        if (interrupted()) { results.push({ id, exitCode: 1, error: 'Interrupted' }); continue; }
        const test = { contracts: 'ContractsTest', infrastructure: 'InfrastructureTest', process: 'ProcessTest' }[suite];
        const result = await collect('php', ['vendor/bin/phpunit', '--filter', test, '--log-junit', join(logs, `${id}.xml`)], root, join(logs, `${id}.log`), dbEnv); results.push({ id, ...result }); console.log(`${id}: ${result.exitCode === 0 && !result.error ? 'PASSED' : 'FAILED'}`);
      }
    } catch (error) { results.push({ id: provider + '-fixture', exitCode: 1, error: error.message }); await collect('docker', ['logs', '--tail', '150', name], root, join(logs, `${provider}-fixture-diagnostic.log`), {}, 30000); }
    finally {
      const removed = await collect('docker', ['rm', '-f', '-v', name], root, join(logs, `${provider}-cleanup.log`), {}, 30000);
      const inspect = spawnSync('docker', ['ps', '-aq', '--filter', 'label=ridhuan.laravel.fixture=' + name], { encoding: 'utf8', windowsHide: true });
      results.push({ id: provider + '-cleanup', exitCode: removed.exitCode === 0 && inspect.status === 0 && inspect.stdout.trim() === '' ? 0 : 1 });
    }
  }
}
await writeFile(join(logs, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.some((result) => result.exitCode !== 0 || result.error);
console.log(`${stage}: ${failed ? 'FAILED' : 'PASSED'}; diagnostics ${logs}`); process.exitCode = failed ? 1 : 0;
