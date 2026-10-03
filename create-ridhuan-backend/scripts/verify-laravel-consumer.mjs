import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { command } from '../dist/process.js';
import { collectProcessCase } from './hardening-process.mjs';
import { phpCommand } from '../dist/runtime/php.js';
const provider = process.argv[2] ?? 'postgresql';
if (!['postgresql', 'mysql'].includes(provider)) throw new Error('Choose postgresql or mysql');
const root = resolve(import.meta.dirname, '..'), scratch = await mkdtemp(join(tmpdir(), 'ridhuan laravel consumer-'));
const project = join(scratch, 'verified-api'), logs = await mkdtemp(join(tmpdir(), 'laravel-consumer-logs-'));
const results = [];
const cancellation = new AbortController();
const runtime = process.argv.includes('--runtime') || process.env.CLI_RUNTIME_TEST === 'true';
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cancellation.abort());
const inventory = ['artifact-install', 'generation', 'locked-install', 'build', 'larastan', 'unit', 'generator', 'generated-build', 'generated-analysis', 'generated-unit', 'archive-provenance', ...(runtime ? ['native-runtime', 'native-manual-generated-http'] : [])];
await writeFile(join(logs, 'inventory.json'), JSON.stringify({ provider, cases: inventory, timeoutMs: 1200000, cleanup: 'owned temp project only; no global Docker resources' }, null, 2));
async function gate(id, name, args, cwd = project) {
  if (cancellation.signal.aborted) throw new Error('Consumer interrupted');
  let executable = name, actual = args;
  if (name === 'composer' || name === 'php') { const c = phpCommand(name, args, cwd); executable = c.executable; actual = c.args; }
  const result = await collectProcessCase({ executable, args: actual, cwd, signal: cancellation.signal }, join(logs, id + '.log'), process.env, 1200000);
  results.push({ id, ...result }); console.log(`${id}: ${result.exitCode === 0 && !result.error ? 'PASSED' : 'FAILED'}`);
  if (result.exitCode !== 0 || result.error) {
    const diagnostic = await readFile(join(logs, id + '.log'), 'utf8').catch(() => 'Log unavailable');
    console.error(diagnostic.slice(-20000).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted fixture JWT]').replace(/^(APP_KEY|JWT_SECRET|DB_PASSWORD|MYSQL_ROOT_PASSWORD)=.*$/gm, '$1=[redacted]'));
  }
  return result.exitCode === 0 && !result.error;
}
try {
  let tarball = process.env.CLI_TARBALL;
  if (!tarball) {
    const pack = command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], root);
    assert.equal(pack.status, 0, 'Artifact packaging failed'); tarball = join(scratch, JSON.parse(pack.stdout)[0].filename);
  }
  const bytes = await readFile(resolve(tarball)); await writeFile(join(logs, 'artifact.sha256'), createHash('sha256').update(bytes).digest('hex'));
  await writeFile(join(scratch, 'package.json'), '{"name":"isolated-laravel-consumer","private":true}\n');
  const npm = command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', resolve(tarball)], scratch);
  results.push({ id: 'artifact-install', exitCode: npm.status, error: npm.error?.message }); assert.equal(npm.status, 0, 'Artifact install failed');
  const cli = join(scratch, 'node_modules/create-ridhuan-backend/dist/bin/index.js');
  assert(await gate('generation', process.execPath, [cli, 'verified-api', '--template', 'laravel', '--database', provider, '--yes', '--no-install'], scratch), 'Generation prerequisite failed');
  assert(await gate('locked-install', 'composer', ['install', '--no-interaction', '--prefer-dist']), 'Install prerequisite failed');
  await gate('build', 'composer', ['build']); await gate('larastan', 'composer', ['analyse']); await gate('unit', 'php', ['vendor/bin/phpunit', '--testsuite', 'Unit']);
  if (await gate('generator', 'php', ['artisan', 'make:backend-module', 'Invoice'])) {
    await gate('generated-build', 'composer', ['build']); await gate('generated-analysis', 'composer', ['analyse']); await gate('generated-unit', 'php', ['vendor/bin/phpunit', '--testsuite', 'Unit']);
    const spec = JSON.parse(await readFile(join(project, 'storage/app/openapi.json'), 'utf8')); assert(spec.paths['/api/invoices'], 'Generated native route absent from OpenAPI');
  }
  const sourceLock = await readFile(join(scratch, 'node_modules/create-ridhuan-backend/templates/laravel/composer.lock'));
  assert.deepEqual(await readFile(join(project, 'composer.lock')), sourceLock, 'Consumer changed dependency lock');
  const identity = JSON.parse(await readFile(join(project, 'composer.json'), 'utf8')); assert.equal(identity.name, 'app/verified-api');
  const env = await readFile(join(project, '.env'), 'utf8'); const key = /^APP_KEY=(.*)$/m.exec(env)?.[1]; const jwt = /^JWT_SECRET=(.*)$/m.exec(env)?.[1]; assert(key?.startsWith('base64:')); assert(jwt && key !== jwt); assert.match(env, /^RATE_LIMIT_STORE=file$/m); assert.match(env, /^APP_PORT=8000$/m);
  const manifest = JSON.parse(await readFile(join(project, 'template-manifest.json'), 'utf8'));
  for (const path of Object.keys(manifest.files)) assert(!/(^|\/)(vendor\/|node_modules\/|\.env$|storage\/framework\/(?!.*(?:\.gitignore|gitignore\.template)$)|storage\/logs\/(?!.*(?:\.gitignore|gitignore\.template)$)|bootstrap\/cache\/(?!(?:\.gitignore|gitignore\.template)$))/.test(path), 'Private runtime path in payload');
  results.push({ id: 'archive-provenance', exitCode: 0 });
  if (runtime) {
    await gate('native-runtime', process.execPath, [join(project, 'scripts/verify.mjs'), '--stage', 'integration', '--only', ['contracts', 'infrastructure', 'process'].map((suite) => `${provider}-${suite}`).join(',')]);
    await gate('native-manual-generated-http', process.execPath, [join(root, 'scripts/verify-laravel-manual.mjs'), project, provider]);
  }
} catch (error) { results.push({ id: 'consumer-scenario', exitCode: 1, error: error.message }); }
finally {
  if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid consumer cleanup scope');
  await rm(scratch, { recursive: true, force: true }); await writeFile(join(logs, 'results.json'), JSON.stringify(results, null, 2));
}
const failed = results.some((result) => result.exitCode !== 0 || result.error); console.log(`laravel/${provider} consumer: ${failed ? 'FAILED' : 'PASSED'}; ${logs}`); process.exitCode = failed ? 1 : 0;
