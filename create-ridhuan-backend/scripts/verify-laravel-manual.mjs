import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { command } from '../dist/process.js';
import { phpCommand } from '../dist/runtime/php.js';
import { collectProcessCase } from './hardening-process.mjs';
const project = resolve(process.argv[2] ?? ''), provider = process.argv[3];
assert(['postgresql', 'mysql'].includes(provider), 'Supply project path and provider');
await readFile(join(project, 'artisan'));
const logs = await mkdtemp(join(tmpdir(), 'laravel-manual-logs-'));
const fixture = 'laravel-manual-' + randomUUID().slice(0, 8), database = 'laravel_test_' + randomBytes(5).toString('hex'), password = randomBytes(24).toString('hex');
const image = provider === 'mysql' ? 'mysql:8.4.8' : 'postgres:18.3-alpine', dbPort = provider === 'mysql' ? 3306 : 5432;
const results = [], cancellation = new AbortController(), serverStop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cancellation.abort(); serverStop.abort(); });
await writeFile(join(logs, 'ownership.json'), JSON.stringify({ fixture, container: fixture, provider, database, workingDirectory: project }, null, 2));
console.log('LARAVEL_MANUAL_OWNER=' + fixture);
await writeFile(join(logs, 'inventory.json'), JSON.stringify({ cases: ['database', 'native-migrate-seed', 'native-http-auth-contracts', 'generated-invoice-real-provider-crud', 'native-shutdown', 'owned-cleanup'], prerequisiteTimeoutMs: 180000, apiTimeoutMs: 15000, serverTimeoutMs: 180000 }, null, 2));
let environment = process.env, serverPromise;
async function php(id, args) {
 const native = phpCommand('php', args, project);
 const result = await collectProcessCase({ ...native, cwd: project, signal: cancellation.signal }, join(logs, id + '.log'), environment, 120000);
 results.push({ id, ...result }); assert.equal(result.exitCode, 0, id + ' failed'); assert(!result.error, id + ' process error');
}
async function until(predicate, timeout = 180000) {
 const deadline = Date.now() + timeout;
 while (Date.now() < deadline && !cancellation.signal.aborted) { if (await predicate()) return; await new Promise(r => setTimeout(r, 500)); }
 throw new Error('Native fixture deadline');
}
const portServer = createServer(); await new Promise((ok, fail) => { portServer.once('error', fail); portServer.listen(0, '127.0.0.1', ok); }); const address = portServer.address(); assert(address && typeof address === 'object'); const port = address.port; await new Promise(ok => portServer.close(ok));
const base = `http://127.0.0.1:${port}`;
async function api(path, method = 'GET', body, token, expected = 200) {
 const response = await fetch(base + path, { method, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(15000)]) });
 assert.equal(response.status, expected, method + ' ' + path); return response;
}
try {
 const args = ['run', '-d', '--name', fixture, '--label', 'ridhuan.laravel.fixture=' + fixture, '-p', `127.0.0.1::${dbPort}`, ...(provider === 'mysql' ? ['-e', 'MYSQL_ROOT_PASSWORD=' + password, '-e', 'MYSQL_DATABASE=' + database, '-e', 'MYSQL_USER=backend', '-e', 'MYSQL_PASSWORD=' + password] : ['-e', 'POSTGRES_USER=backend', '-e', 'POSTGRES_DB=' + database, '-e', 'POSTGRES_PASSWORD=' + password]), image];
 const started = await collectProcessCase({ executable: 'docker', args, cwd: project, signal: cancellation.signal }, join(logs, 'database.log'), process.env, 180000); results.push({ id: 'database', ...started }); assert.equal(started.exitCode, 0);
 await until(() => command('docker', ['exec', fixture, ...(provider === 'mysql' ? ['mysqladmin', 'ping', '-h127.0.0.1', '--silent'] : ['pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'backend', '-d', database])], project).status === 0);
 const mapped = command('docker', ['port', fixture, dbPort + '/tcp'], project).stdout.trim().split(':').at(-1); assert(/^\d+$/.test(mapped));
 environment = { ...process.env, APP_ENV: 'testing', DB_PROVIDER: provider, DB_HOST: '127.0.0.1', DB_PORT: mapped, DB_DATABASE: database, DB_USERNAME: 'backend', DB_PASSWORD: password, ADMIN_PASSWORD: 'FixtureOnly!123', SMTP_ENABLED: 'false', CACHE_ENABLED: 'false', RATE_LIMIT_STORE: 'file', APP_INSTANCE_COUNT: '1', OTEL_ENABLED: 'false', RATE_LIMIT_AUTH_MAX: '10000', RATE_LIMIT_PUBLIC_MAX: '10000', RATE_LIMIT_INTERNAL_MAX: '10000' };
 await php('native-config', ['artisan', 'config:clear']); await php('native-migrate', ['artisan', 'backend:migrate', '--force']); await php('native-seed', ['artisan', 'backend:seed']); await php('native-seed-repeat', ['artisan', 'backend:seed']); await php('native-configuration', ['artisan', 'backend:validate-config']);
 const native = phpCommand('php', ['artisan', 'serve', '--host=127.0.0.1', '--port=' + port, '--no-reload'], project);
 serverPromise = collectProcessCase({ ...native, cwd: project, signal: AbortSignal.any([cancellation.signal, serverStop.signal]) }, join(logs, 'native-http.log'), environment, 180000);
 await until(async () => { try { return (await fetch(base + '/ready', { signal: AbortSignal.timeout(1500) })).status === 200; } catch { return false; } }, 60000);
 for (const path of ['/health', '/live', '/ready']) assert.equal((await (await api(path)).json()).data.status, 'ok');
 const login = await (await api('/api/auth/login', 'POST', { email: 'admin@example.com', password: 'FixtureOnly!123' })).json(), token = login.data.token;
 assert(token && login.data.refreshToken); await api('/api/auth/me', 'GET', undefined, token);
 await api('/api/auth/register', 'POST', { email: 'bad', password: 'short' }, undefined, 422);
 const member = await (await api('/api/auth/register', 'POST', { email: 'manual@example.com', password: 'FixtureOnly!123' }, undefined, 201)).json(); assert(!('password' in member.data));
 const memberLogin = await (await api('/api/auth/login', 'POST', { email: 'manual@example.com', password: 'FixtureOnly!123' })).json();
 await api('/api/users', 'GET', undefined, memberLogin.data.token, 403);
 const rotated = await (await api('/api/auth/refresh', 'POST', { refreshToken: memberLogin.data.refreshToken })).json(); await api('/api/auth/refresh', 'POST', { refreshToken: memberLogin.data.refreshToken }, undefined, 401); await api('/api/auth/refresh', 'POST', { refreshToken: rotated.data.refreshToken }, undefined, 401); await api('/api/auth/logout', 'POST', { refreshToken: 'unknown' }, undefined, 204);
 const list = await (await api('/api/users?search=manual%40example.com&fields=id,email', 'GET', undefined, token)).json(); assert.equal(list.data.length, 1); assert.deepEqual(Object.keys(list.data[0]).sort(), ['email', 'id']);
 const spec = await (await api('/docs/openapi.json')).json(); assert(spec.paths['/api/invoices']); assert(spec.paths['/api/auth/register'].post.responses['422']);
 results.push({ id: 'native-http-auth-contracts', exitCode: 0 });
 await php('grant-invoice', ['tests/Fixtures/inspect.php', 'grant-invoice']);
 await api('/api/invoices', 'GET', undefined, undefined, 401); await api('/api/invoices', 'GET', undefined, memberLogin.data.token, 403);
 await api('/api/invoices', 'POST', {}, token, 422);
 const invoice = await (await api('/api/invoices', 'POST', { name: 'Generated invoice' }, token, 201)).json(); assert.deepEqual(Object.keys(invoice.data).sort(), ['createdAt', 'id', 'name', 'updatedAt']);
 assert.equal((await (await api('/api/invoices/' + invoice.data.id, 'GET', undefined, token)).json()).data.name, 'Generated invoice');
 assert.equal((await (await api('/api/invoices/' + invoice.data.id, 'PATCH', { name: 'Updated invoice' }, token)).json()).data.name, 'Updated invoice');
 assert.equal((await (await api('/api/invoices', 'GET', undefined, token)).json()).data.length, 1);
 await api('/api/invoices/' + invoice.data.id, 'DELETE', undefined, token, 204); await api('/api/invoices/' + invoice.data.id, 'GET', undefined, token, 404);
 results.push({ id: 'generated-invoice-real-provider-crud', exitCode: 0 });
} catch (error) { results.push({ id: 'native-http-scenario', exitCode: 1, error: error.message }); }
finally {
 serverStop.abort(); if (serverPromise) { const stopped = await serverPromise; results.push({ id: 'native-shutdown', exitCode: stopped.aborted && !stopped.timedOut ? 0 : 1 }); }
 const removed = command('docker', ['rm', '-f', '-v', fixture], project);
 const remaining = command('docker', ['ps', '-aq', '--filter', 'label=ridhuan.laravel.fixture=' + fixture], project);
 await writeFile(join(logs, 'cleanup.log'), removed.stdout + removed.stderr);
 results.push({ id: 'owned-cleanup', exitCode: removed.status === 0 && remaining.status === 0 && remaining.stdout.trim() === '' ? 0 : 1 });
 await writeFile(join(logs, 'results.json'), JSON.stringify(results, null, 2));
}
const failed = cancellation.signal.aborted || results.some(r => r.exitCode !== 0 || r.error); console.log(`Laravel native manual/${provider}: ${failed ? 'FAILED' : 'PASSED'}; ${logs}`); process.exitCode = failed ? 1 : 0;
