import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createServer as tlsServer } from 'node:tls';
import { createServer as httpServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import pg from 'pg';
import mysql from 'mysql2/promise';
import { command } from '../dist/process.js';
import { replaceEnv } from '../dist/scaffold/env.js';
import { collectProcessCase } from './hardening-process.mjs';

const provider = process.argv[2] ?? 'postgresql';
if (!['postgresql', 'mysql'].includes(provider)) throw new Error('Choose postgresql or mysql');
const root = resolve(import.meta.dirname, '..'), scratch = await mkdtemp(join(tmpdir(), 'ridhuan laravel compose-'));
const project = join(scratch, 'acceptance-api'), logs = await mkdtemp(join(tmpdir(), 'laravel-compose-logs-'));
const fixture = 'laravel-acceptance-' + randomUUID().slice(0, 8), database = 'laravel_test_' + randomBytes(5).toString('hex');
const dbService = provider === 'mysql' ? 'mysql' : 'postgres';
const results = [], sockets = new Set(), timers = new Set();
const originalPassword = process.env.RIDHUAN_DB_PASSWORD;
const state = { delay: 0, accepted: 0, active: 0, telemetry: 0, fail: false, wire: [], paths: new Set() };
let secureSmtp;
function smtpConnection(socket) {
  sockets.add(socket); socket.setEncoding('utf8'); socket.write('220 fixture ESMTP\r\n'); let buffered = '', data = false;
  socket.on('close', () => sockets.delete(socket)); socket.on('error', () => socket.destroy());
  socket.on('data', (chunk) => {
    buffered += chunk; if (buffered.length > 32000) { socket.destroy(); return; }
    while (buffered.includes('\r\n')) {
      const end = buffered.indexOf('\r\n'), line = buffered.slice(0, end); buffered = buffered.slice(end + 2);
      if (data) {
        if (line === '.') {
          data = false; state.active++;
          const timer = setTimeout(() => { timers.delete(timer); state.active--; if (state.fail) socket.write('451 fixture retry\r\n'); else { state.accepted++; socket.write('250 queued\r\n'); } }, state.delay); timers.add(timer);
        }
      } else if (/^EHLO /i.test(line)) socket.write('250-fixture\r\n250 8BITMIME\r\n');
      else if (/^(HELO |MAIL FROM:|RCPT TO:|RSET|NOOP)/i.test(line)) socket.write('250 OK\r\n');
      else if (line === 'DATA') { data = true; socket.write('354 End with .\r\n'); }
      else if (line === 'QUIT') socket.end('221 Bye\r\n'); else socket.write('502 Not implemented\r\n');
    }
  });
}
const smtp = createServer(smtpConnection);
const collector = httpServer((request, response) => {
  let bytes = 0; const chunks = []; request.on('data', (data) => { bytes += data.length; if (bytes > 1000000) request.destroy(); else chunks.push(data); });
  request.on('end', () => { state.telemetry++; state.paths.add(request.url); if (state.wire.length < 2000) state.wire.push(Buffer.concat(chunks)); response.writeHead(200, { 'Content-Type': 'application/x-protobuf' }); response.end(); });
});
async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); }); const address = server.address(); assert(address && typeof address === 'object'); return address.port; }
async function port() { const server = createServer(); const p = await listen(server); await new Promise((resolve) => server.close(resolve)); return p; }
const smtpPort = await listen(smtp), collectorPort = await listen(collector);
const httpPort = await port(), dbPort = await port(), redisPort = await port(), s3Port = await port();
const inventory = ['full-image-build', 'startup-migration-seed', 'health-docs-private-root', 'auth-rbac-wire', 'local-upload-download', 'sse-backlog-cursor-expiry-admission-cancel', 'smtp-parent-renewal-two-children', 'smtp-failure-recovery', 'smtp-tls-verification', 'redis-shared-quota-cache-outage', 's3-storage-compensation', 'cleanup-dry-apply', 'telemetry-active-outage', 'database-outage-live-ready', 'owned-cleanup'];
await writeFile(join(logs, 'inventory.json'), JSON.stringify({ provider, fixture, database, cases: inventory, apiTimeoutMs: 15000, buildTimeoutMs: 900000, startupTimeoutMs: 900000, scenarioTimeoutMs: 180000, cleanup: 'finally down --volumes --remove-orphans and owned image tags; check labels' }, null, 2));
await writeFile(join(logs, 'ownership.json'), JSON.stringify({ project: fixture, workingDirectory: project, fixture, provider }, null, 2));
let sequence = 0, interrupted = false;
const cancellation = new AbortController();
let activeScenario;
let checkpoint;
const selected = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]?.split(',') : null;
if (selected && (!selected.length || selected.some((id) => !inventory.includes(id)))) throw new Error('Unknown Compose scenario');
const prerequisites = new Set(['full-image-build', 'startup-migration-seed', 'health-docs-private-root', 'auth-rbac-wire']);
async function mark(id) { checkpoint = id; await writeFile(join(logs, 'checkpoint.json'), JSON.stringify({ id, at: new Date().toISOString() })); }
async function run(name, args, cwd = project) {
  const log = join(logs, `${++sequence}-${basename(name).replace(/[^a-zA-Z0-9._-]/g, '-')}.log`);
  const signal = activeScenario ? AbortSignal.any([cancellation.signal, activeScenario.signal]) : cancellation.signal;
  const result = await collectProcessCase({ executable: name, args, cwd, signal }, log, process.env, 900000);
  assert.equal(result.exitCode, 0, `${name} failed (exit ${result.exitCode}; ${result.error ?? 'no process error'})`); return readFile(log, 'utf8');
}
const compose = (...args) => run('docker', ['compose', '-p', fixture, '-f', 'compose.yaml', '-f', 'acceptance.yaml', ...args]);
const inspect = (action = 'stats') => { const result = command('docker', ['compose', '-p', fixture, '-f', 'compose.yaml', '-f', 'acceptance.yaml', 'exec', '-T', 'app', 'php', 'tests/Fixtures/inspect.php', action], project); assert.equal(result.status, 0, 'Read fixture failed'); return result.stdout; };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate, timeout = 60000) { const deadline = Date.now() + timeout; while (Date.now() < deadline && !interrupted && !activeScenario?.signal.aborted) { if (await predicate()) return; await pause(500); } throw new Error('Scenario predicate timeout'); }
async function scenario(id, body) {
  if (selected && !selected.includes(id) && !prerequisites.has(id)) return;
  if (interrupted) { results.push({ id, exitCode: 1, error: 'Interrupted' }); return; }
  const started = Date.now();
  const timeoutMs = id === 'full-image-build' || id === 'startup-migration-seed' ? 900000 : 180000;
  activeScenario = new AbortController(); checkpoint = undefined; const timeout = setTimeout(() => activeScenario?.abort(), timeoutMs);
  try { await body(); assert(!activeScenario.signal.aborted, 'Scenario exceeded deadline'); results.push({ id, exitCode: 0, ms: Date.now() - started }); console.log(`${id}: PASSED`); }
  catch (error) {
    const diagnosticLog = join(logs, id + '-runtime.log');
    const diagnostic = await collectProcessCase({ executable: 'docker', args: ['compose', '-p', fixture, '-f', 'compose.yaml', '-f', 'acceptance.yaml', '--profile', '*', 'logs', '--no-color', '--tail', '100', 'app', 'web', 'worker'], cwd: project, signal: cancellation.signal }, diagnosticLog, process.env, 30000);
    results.push({ id, exitCode: 1, error: error.message, stack: error.stack, cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message, code: error.cause.code, stack: error.cause.stack } : undefined, checkpoint, timedOut: activeScenario.signal.aborted && !cancellation.signal.aborted, timeoutMs, diagnosticExitCode: diagnostic.exitCode, ms: Date.now() - started }); console.log(`${id}: FAILED`);
  }
  finally { clearTimeout(timeout); activeScenario = undefined; await writeFile(join(logs, id + '.json'), JSON.stringify(results.at(-1), null, 2)); }
}
async function env(values) { const path = join(project, '.env'); await writeFile(path, replaceEnv(await readFile(path, 'utf8'), values)); }
const url = `http://127.0.0.1:${httpPort}`;
async function api(path, method = 'GET', body, token, expected = 200) {
  const headers = { ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const signal = AbortSignal.any([cancellation.signal, ...(activeScenario ? [activeScenario.signal] : []), AbortSignal.timeout(15000)]);
  const response = await fetch(url + path, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal });
  assert.equal(response.status, expected, `${method} ${path} status`); return response;
}
let adminToken, actorId, memberToken, memberId;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = true; cancellation.abort(); });
try {
  process.env.RIDHUAN_DB_PASSWORD = 'fixture #$HOME quote" apostrophe\' back\\slash-日本;end\\';
  await run(process.execPath, [join(root, 'dist/bin/index.js'), 'acceptance-api', '--template', 'laravel', '--database', provider, '--yes', '--no-install', '--mode', 'docker', '--port', String(httpPort), '--db-port', String(dbPort), '--db-name', database, '--db-user', 'backend'], scratch);
  await env({ COMPOSE_PROJECT_NAME: fixture, APP_ENV: 'testing', ADMIN_PASSWORD: 'FixtureOnly!123', RATE_LIMIT_AUTH_MAX: '10000', RATE_LIMIT_PUBLIC_MAX: '10000', RATE_LIMIT_INTERNAL_MAX: '10000', SSE_LIFETIME_SECONDS: '6', SSE_MAX_CONNECTIONS_PER_INSTANCE: '2', REDIS_PORT: String(redisPort), MINIO_PORT: String(s3Port), SMTP_HOST: 'host.docker.internal', SMTP_PORT: String(smtpPort), OTEL_EXPORTER_OTLP_ENDPOINT: `http://host.docker.internal:${collectorPort}` });
  await writeFile(join(project, 'acceptance.yaml'), `services:\n${provider === 'mysql' ? '  mysql:\n    environment:\n      MYSQL_ROOT_HOST: "%"\n' : ''}  app:\n    extra_hosts: ["host.docker.internal:host-gateway"]\n    environment:\n      OTEL_EXPORTER_OTLP_ENDPOINT: http://host.docker.internal:${collectorPort}\n  worker:\n    extra_hosts: ["host.docker.internal:host-gateway"]\n    environment:\n      OTEL_EXPORTER_OTLP_ENDPOINT: http://host.docker.internal:${collectorPort}\n`);
  // Cold image compilation must finish before any runtime acceptance deadline starts.
  await scenario('full-image-build', async () => {
    await mark('build-all-images');
    await compose('--profile', '*', 'build');
  });
  if (results.at(-1)?.exitCode !== 0) throw new Error('Full image build prerequisite failed');
  await scenario('startup-migration-seed', async () => {
    await compose('up', '--no-build', '-d', '--wait', '--wait-timeout', '240'); await compose('exec', '-T', 'app', 'php', 'artisan', 'backend:seed'); await compose('exec', '-T', 'app', 'php', 'artisan', 'backend:seed');
    const login = await (await api('/api/auth/login', 'POST', { email: 'admin@example.com', password: 'FixtureOnly!123' })).json(); adminToken = login.data.token;
    const me = await (await api('/api/auth/me', 'GET', undefined, adminToken)).json(); actorId = me.data.id;
  });
  await scenario('health-docs-private-root', async () => {
    for (const path of ['/health', '/live', '/ready']) assert.equal((await (await api(path)).json()).data.status, 'ok');
    const spec = await (await api('/docs/openapi.json')).json(); assert.equal(Object.values(spec.paths).reduce((total, path) => total + Object.keys(path).length, 0), 33); assert(spec.paths['/api/auth/register'].post.responses['422']); assert(spec.components.securitySchemes.bearerAuth);
    await api('/docs'); await api('/docs/specs/user.json');
    for (const path of ['/.env', '/vendor/autoload.php', '/storage/logs/laravel.log', '/config/app.php']) { const response = await fetch(url + path); assert([403, 404].includes(response.status), 'Private path exposed'); }
    assert.equal(state.telemetry, 0, 'Disabled telemetry must not export');
    await env({ OTEL_ENABLED: 'true' }); await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'app', 'worker'); await wait(async () => (await fetch(url + '/ready')).status === 200);
  });
  await scenario('auth-rbac-wire', async () => {
    await api('/api/auth/register', 'POST', { email: 'bad', password: 'short' }, undefined, 422);
    const registered = await (await api('/api/auth/register', 'POST', { email: ' MEMBER@EXAMPLE.COM ', password: 'ValidPassword!123' }, undefined, 201)).json(); memberId = registered.data.id; assert.equal(registered.data.email, 'member@example.com'); assert(!('password' in registered.data));
    const member = await (await api('/api/auth/login', 'POST', { email: 'member@example.com', password: 'ValidPassword!123' })).json(); memberToken = member.data.token;
    await api('/api/users', 'GET', undefined, memberToken, 403); await api('/api/auth/logout', 'POST', { refreshToken: 'unknown' }, undefined, 204);
    const rotated = await (await api('/api/auth/refresh', 'POST', { refreshToken: member.data.refreshToken })).json(); await api('/api/auth/refresh', 'POST', { refreshToken: member.data.refreshToken }, undefined, 401); await api('/api/auth/refresh', 'POST', { refreshToken: rotated.data.refreshToken }, undefined, 401);
    const list = await (await api('/api/users?limit=1&page=1&fields=id,email', 'GET', undefined, adminToken)).json(); assert.equal(list.meta.limit, 1); assert(!('password' in list.data[0]));
    // Alternating response statuses exercises fresh FastCGI requests after FPM closes its socket.
    for (let i = 0; i < 40; i++) {
      await api('/api/auth/logout', 'POST', { refreshToken: 'burst-unknown' }, undefined, 204);
      await api('/api/auth/refresh', 'POST', { refreshToken: 'burst-unknown' }, undefined, 401);
      await api('/live');
    }
  });
  await scenario('local-upload-download', async () => {
    const data = new FormData(); data.set('file', new Blob(['%PDF-1.7\nfixture\n%%EOF'], { type: 'application/pdf' }), 'fixture.pdf');
    const uploaded = await (await api('/api/upload', 'POST', data, adminToken, 201)).json(); assert(!('objectKey' in uploaded.data));
    const download = await api('/api/upload/' + uploaded.data.id + '?download=true', 'GET', undefined, adminToken); assert.match(await download.text(), /^%PDF/);
  });
  await scenario('sse-backlog-cursor-expiry-admission-cancel', async () => {
    await mark('sse-backlog');
    inspect('backlog');
    const headers = { Authorization: 'Bearer ' + adminToken };
    const first = await fetch(url + '/api/notifications/stream', { headers, signal: AbortSignal.timeout(12000) }); assert.equal(first.status, 200); const frames = await first.text(); const ids = [...frames.matchAll(/^id: ([^\n]+)/gm)].map((match) => match[1]); assert.equal(ids.length, 120); assert.equal(new Set(ids).size, 120);
    await api('/api/notifications/' + ids.at(-1) + '/read', 'PATCH', {}, adminToken);
    await mark('sse-resume');
    const resume = await fetch(url + '/api/notifications/stream', { headers: { ...headers, 'Last-Event-ID': ids.at(-2) }, signal: AbortSignal.timeout(12000) }); assert.equal(resume.status, 200); assert.match(await resume.text(), new RegExp(ids.at(-1)));
    const foreign = await (await api('/api/notifications', 'POST', { recipientId: memberId, title: 'Foreign', body: 'Body' }, adminToken, 201)).json(); const rejected = await fetch(url + '/api/notifications/stream', { headers: { ...headers, 'Last-Event-ID': foreign.data.id } }); assert.equal(rejected.status, 400); assert(!rejected.headers.get('Content-Type').includes('text/event-stream'));
    await mark('sse-admission');
    const abort1 = new AbortController(), abort2 = new AbortController(); const streams = await Promise.all([fetch(url + '/api/notifications/stream', { headers, signal: abort1.signal }), fetch(url + '/api/notifications/stream', { headers, signal: abort2.signal })]); streams.forEach((r) => assert.equal(r.status, 200));
    await api('/live'); const full = await fetch(url + '/api/notifications/stream', { headers }); assert.equal(full.status, 503); abort1.abort(); abort2.abort(); await pause(7500);
    await mark('sse-expiry');
    const shortToken = inspect('short-token').trim(), started = Date.now(); const expiry = await fetch(url + '/api/notifications/stream', { headers: { Authorization: 'Bearer ' + shortToken }, signal: AbortSignal.timeout(7000) }); assert.equal(expiry.status, 200); await expiry.text(); assert(Date.now() - started < 6500);
    await mark('sse-inactive');
    const cancelled = new AbortController(); const inactive = await fetch(url + '/api/notifications/stream', { headers, signal: cancelled.signal }); inspect('inactive'); await inactive.text(); inspect('restore'); await api('/live');
    await mark('sse-slow-client');
    await new Promise((resolve, reject) => {
      const slow = httpRequest(url + '/api/notifications/stream', { headers }, (response) => {
        response.pause();
        api('/live').then(() => { slow.destroy(); resolve(); }, (error) => { slow.destroy(); reject(error); });
      });
      slow.setTimeout(10000, () => { slow.destroy(); reject(new Error('Slow client deadline')); });
      slow.on('error', (error) => { if (!slow.destroyed) reject(error); }); slow.end();
    });
    await pause(7500); await api('/live');
    await mark('sse-database-outage');
    const outage = await fetch(url + '/api/notifications/stream', { headers, signal: AbortSignal.timeout(30000) });
    await compose('stop', dbService); await outage.text(); await api('/live');
    await compose('start', dbService); await wait(async () => (await fetch(url + '/ready')).status === 200);
  });
  await scenario('smtp-parent-renewal-two-children', async () => {
    await env({ SMTP_ENABLED: 'true' }); await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'app', 'worker'); await wait(async () => (await fetch(url + '/ready')).status === 200);
    const connection = provider === 'mysql'
      ? await mysql.createConnection({ host: '127.0.0.1', port: dbPort, user: 'backend', password: process.env.RIDHUAN_DB_PASSWORD, database, timezone: 'Z', connectTimeout: 5000 })
      : new pg.Client({ host: '127.0.0.1', port: dbPort, user: 'backend', password: process.env.RIDHUAN_DB_PASSWORD, database, connectionTimeoutMillis: 5000, query_timeout: 5000 });
    try {
      if (provider === 'postgresql') await connection.connect();
      const jobs = async () => {
        const sql = 'SELECT id, status, lease_until FROM email_jobs ORDER BY id';
        const reply = provider === 'mysql' ? await connection.query({ sql, timeout: 5000 }) : await connection.query(sql);
        const rows = provider === 'mysql' ? reply[0] : reply.rows;
        assert(Array.isArray(rows));
        for (const row of rows) { assert.equal(typeof row.id, 'string'); assert.equal(typeof row.status, 'string'); assert(row.lease_until === null || row.lease_until instanceof Date); }
        return rows;
      };
      state.delay = 23000;
      await Promise.all([0, 1].map(i => api('/api/notifications', 'POST', { recipientId: actorId, title: 'Blocking ' + i, body: 'Immutable fixture', sendEmail: true }, adminToken, 201)));
      await wait(() => state.active === 2);
      const before = await jobs(); assert.equal(before.length, 2); assert(before.every(j => j.status === 'PENDING' && j.lease_until instanceof Date));
      // Observe both renewals while SMTP is still blocked; Docker exec latency must not consume the23s window.
      await wait(async () => { const renewed = await jobs(); return renewed.length === 2 && renewed.every(j => j.status === 'PENDING' && j.lease_until instanceof Date && j.lease_until.getTime() > before.find(p => p.id === j.id).lease_until.getTime()); }, 23000);
      assert.equal(state.active, 2);
      await wait(async () => (await jobs()).filter(j => j.status === 'SENT').length === 2); assert.equal(state.accepted, 2);
    } finally { state.delay = 0; await connection.end(); }
  });
  await scenario('smtp-failure-recovery', async () => {
    state.fail = true; const notice = await (await api('/api/notifications', 'POST', { recipientId: actorId, title: 'Retry', body: 'Body', sendEmail: true }, adminToken, 201)).json();
    await wait(() => JSON.parse(inspect()).jobs.some((j) => j.notificationId === notice.data.id && j.attempts >= 1 && j.leaseUntil === null)); state.fail = false;
    await wait(() => JSON.parse(inspect()).jobs.some((j) => j.notificationId === notice.data.id && j.status === 'SENT')); await env({ SMTP_ENABLED: 'false' }); await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'worker');
  });
  await scenario('smtp-tls-verification', async () => {
    const generated = command('docker', ['compose', '-p', fixture, '-f', 'compose.yaml', '-f', 'acceptance.yaml', 'exec', '-T', 'app', 'php', 'tests/Fixtures/certificate.php'], project);
    assert.equal(generated.status, 0, 'Disposable TLS certificate creation failed');
    const material = JSON.parse(generated.stdout); assert.equal(typeof material.cert, 'string'); assert.equal(typeof material.key, 'string');
    secureSmtp = tlsServer(material, smtpConnection); secureSmtp.on('tlsClientError', () => {}); const securePort = await listen(secureSmtp);
    await env({ SMTP_ENABLED: 'true', SMTP_SECURE: 'true', SMTP_PORT: String(securePort), SMTP_HOST: 'host.docker.internal' }); await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'app', 'worker'); await wait(async () => (await fetch(url + '/ready')).status === 200);
    const untrusted = await (await api('/api/notifications', 'POST', { recipientId: actorId, title: 'Untrusted TLS', body: 'Body', sendEmail: true }, adminToken, 201)).json();
    await wait(() => JSON.parse(inspect()).jobs.some((j) => j.notificationId === untrusted.data.id && j.attempts >= 1 && j.leaseUntil === null && j.status === 'PENDING'));
    const ca = join(scratch, 'fixture-ca.pem'), ini = join(scratch, 'fixture-ca.ini'); await writeFile(ca, material.cert); await writeFile(ini, 'openssl.cafile=/run/fixture-ca.pem\n');
    let override = await readFile(join(project, 'acceptance.yaml'), 'utf8'); override = override.replace('  worker:\n', '  worker:\n    volumes:\n      - ' + JSON.stringify(ca.replaceAll('\\', '/') + ':/run/fixture-ca.pem:ro') + '\n      - ' + JSON.stringify(ini.replaceAll('\\', '/') + ':/usr/local/etc/php/conf.d/fixture-ca.ini:ro') + '\n'); override = override.replaceAll('["host.docker.internal:host-gateway"]', '["host.docker.internal:host-gateway", "wrong.fixture:host-gateway"]'); await writeFile(join(project, 'acceptance.yaml'), override);
    await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'worker');
    await wait(() => JSON.parse(inspect()).jobs.some((j) => j.notificationId === untrusted.data.id && j.status === 'SENT'));
    await env({ SMTP_HOST: 'wrong.fixture' }); await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'worker');
    const wrongName = await (await api('/api/notifications', 'POST', { recipientId: actorId, title: 'Wrong TLS hostname', body: 'Body', sendEmail: true }, adminToken, 201)).json();
    await wait(() => JSON.parse(inspect()).jobs.some((j) => j.notificationId === wrongName.data.id && j.attempts >= 1 && j.leaseUntil === null && j.status === 'PENDING'));
    await env({ SMTP_ENABLED: 'false', SMTP_SECURE: 'false', SMTP_HOST: 'host.docker.internal', SMTP_PORT: String(smtpPort) }); await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'worker');
  });
  await scenario('redis-shared-quota-cache-outage', async () => {
    await mark('redis-start-two-replicas');
    await env({ COMPOSE_PROFILES: 'redis', RATE_LIMIT_STORE: 'redis', RATE_LIMIT_AUTH_MAX: '7', RATE_LIMIT_AUTH_WINDOW_SECONDS: '300', CACHE_ENABLED: 'true', APP_INSTANCE_COUNT: '2' }); await compose('up', '-d', '--wait', 'redis'); await compose('up', '-d', '--wait', '--force-recreate', '--scale', 'app=2', 'app');
    await mark('redis-web-ready');
    // Recreating web must neither rescale its dependencies to one app nor race its listener.
    await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'web');
    const replicas = (await compose('ps', '-q', 'app')).trim().split(/\r?\n/).filter(Boolean); assert.equal(replicas.length, 2, 'Two distributed quota replicas required after web recreation');
    await api('/ready');
    await mark('redis-twenty-quota-requests');
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, async () => {
      const signal = AbortSignal.any([cancellation.signal, activeScenario.signal, AbortSignal.timeout(15000)]);
      const response = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unknown@example.com', password: 'FixtureOnly!123' }), signal });
      await response.arrayBuffer(); return response.status;
    }));
    await writeFile(join(logs, 'redis-quota-attempts.json'), JSON.stringify(attempts.map((result, index) => result.status === 'fulfilled' ? { index, status: result.value } : { index, error: result.reason.message, stack: result.reason.stack, cause: result.reason.cause instanceof Error ? { message: result.reason.cause.message, code: result.reason.cause.code } : undefined }), null, 2));
    assert.equal(attempts.filter((result) => result.status === 'rejected').length, 0, 'All twenty quota requests must complete without transport failures');
    assert.equal(attempts.filter((result) => result.status === 'fulfilled' && result.value === 401).length, 7);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled' && result.value === 429).length, 13);
    await mark('redis-cache-authorization-projections-invalidation');
    await api('/api/users', 'GET', undefined, adminToken); await api('/api/users', 'GET', undefined, memberToken, 403);
    const onlyIds = await (await api('/api/users?search=member%40example.com&fields=id', 'GET', undefined, adminToken)).json(); assert.equal(onlyIds.data.length, 1); assert.deepEqual(Object.keys(onlyIds.data[0]), ['id']);
    const emailFields = await (await api('/api/users?search=member%40example.com&fields=email', 'GET', undefined, adminToken)).json(); assert.deepEqual(Object.keys(emailFields.data[0]), ['email']); assert.equal(emailFields.data[0].email, 'member@example.com');
    await api('/api/users/' + memberId, 'PATCH', { email: 'changed@example.com' }, adminToken);
    const invalidated = await (await api('/api/users?search=member%40example.com&fields=id', 'GET', undefined, adminToken)).json(); assert.equal(invalidated.data.length, 0, 'Mutation must invalidate cached filtered response');
    await api('/api/users/' + memberId, 'PATCH', { email: 'member@example.com' }, adminToken);
    await mark('redis-outage-fail-closed');
    await compose('stop', 'redis'); await api('/live'); await api('/ready', 'GET', undefined, undefined, 503); await api('/api/auth/login', 'POST', { email: 'unknown@example.com', password: 'FixtureOnly!123' }, undefined, 503);
    await mark('redis-file-store-recovery');
    await env({ RATE_LIMIT_STORE: 'file', RATE_LIMIT_AUTH_MAX: '10000', CACHE_ENABLED: 'false', COMPOSE_PROFILES: '', APP_INSTANCE_COUNT: '1' }); await compose('up', '-d', '--wait', '--force-recreate', '--scale', 'app=1', 'app'); await compose('up', '-d', '--wait', '--no-deps', '--force-recreate', 'web'); await api('/ready');
  });
  await scenario('s3-storage-compensation', async () => {
    await env({ COMPOSE_PROFILES: 's3', UPLOAD_STORAGE: 's3', S3_ACCESS_KEY_ID: 'fixture-access', S3_SECRET_ACCESS_KEY: 'fixture-secret-12345', S3_BUCKET: 'uploads' }); await compose('up', '-d', '--no-build', '--wait', 'minio'); await compose('run', '--rm', '--no-deps', '--pull', 'never', 'minio-init'); await compose('up', '-d', '--no-build', '--force-recreate', 'app'); await wait(async () => (await fetch(url + '/ready')).status === 200);
    const form = new FormData(); form.set('file', new Blob(['%PDF-1.7\nfixture S3\n%%EOF'], { type: 'application/pdf' }), 's3.pdf'); const uploaded = await (await api('/api/upload', 'POST', form, adminToken, 201)).json(); assert.match(await (await api('/api/upload/' + uploaded.data.id + '?download=true', 'GET', undefined, adminToken)).text(), /fixture S3/);
    const before = JSON.parse(inspect());
    inspect('fault-audit-on');
    try {
      const failed = new FormData(); failed.set('file', new Blob(['%PDF-1.7\ncompensation fixture\n%%EOF'], { type: 'application/pdf' }), 'compensation.pdf');
      await api('/api/upload', 'POST', failed, adminToken, 500);
      const after = JSON.parse(inspect()); assert.equal(after.objects, before.objects, 'S3 compensation must delete owned failed object'); assert.equal(after.files, before.files, 'Failed SQL metadata must roll back');
    } finally { inspect('fault-audit-off'); }
  });
  await scenario('cleanup-dry-apply', async () => { const before = JSON.parse(inspect()); await compose('exec', '-T', 'app', 'php', 'artisan', 'backend:cleanup', '--dry-run'); await compose('exec', '-T', 'app', 'php', 'artisan', 'backend:cleanup', '--apply'); const after = JSON.parse(inspect()); assert.equal(after.files, before.files); assert.deepEqual(after.sequences, before.sequences); });
  await scenario('telemetry-active-outage', async () => {
    await env({ OTEL_ENABLED: 'true' }); await compose('up', '-d', '--force-recreate', 'app'); await wait(async () => (await fetch(url + '/ready')).status === 200); await api('/live'); await api('/api/users', 'GET', undefined, adminToken); await wait(() => state.telemetry > 0);
    assert(state.paths.has('/v1/traces') && state.paths.has('/v1/metrics'), 'Both native SDK trace and metric exporters required');
    const wire = Buffer.concat(state.wire);
    for (const field of ['backend.operations', 'backend.duration', 'backend.events', 'db.query', 'redis.quota', 'storage.put', 'email.deliver', 'outbox.complete', 'outbox.attempts', 'outbox.lease.renewed', 'cleanup.run', 'sse.connection', 'sse.notification']) assert(wire.includes(Buffer.from(field)), 'Missing telemetry operation: ' + field);
    for (const privateValue of [adminToken, memberToken, 'FixtureOnly!123', 'member@example.com', 'Blocking 0', 'Immutable fixture', process.env.RIDHUAN_DB_PASSWORD]) assert(privateValue && !wire.includes(Buffer.from(privateValue)), 'Private value leaked to telemetry');
    await new Promise((resolve) => collector.close(resolve)); await api('/ready'); await api('/live');
  });
  await scenario('database-outage-live-ready', async () => { await compose('stop', dbService); await api('/live'); await api('/ready', 'GET', undefined, undefined, 503); await compose('start', dbService); await wait(async () => (await fetch(url + '/ready')).status === 200); });
} catch (error) { results.push({ id: 'fixture-bootstrap', exitCode: 1, error: error.message }); }
finally {
  if (results.some(result => result.exitCode !== 0)) {
    const diagnostic = command('docker', ['compose', '-p', fixture, '-f', 'compose.yaml', '-f', 'acceptance.yaml', '--profile', '*', 'logs', '--no-color', '--tail', '100', 'app', 'web', 'worker'], project);
    await writeFile(join(logs, 'runtime-diagnostics.log'), (diagnostic.stdout ?? '') + (diagnostic.stderr ?? ''));
  }
    for (const timer of timers) clearTimeout(timer); for (const socket of sockets) socket.destroy(); smtp.close(); secureSmtp?.close(); collector.close();
  const down = command('docker', ['compose', '-p', fixture, '-f', 'compose.yaml', '-f', 'acceptance.yaml', '--profile', '*', 'down', '--volumes', '--remove-orphans', '--rmi', 'local'], project);
  await writeFile(join(logs, 'cleanup.log'), (down.stdout ?? '') + (down.stderr ?? ''));
  const leftover = ['container', 'volume', 'network'].map((type) => command('docker', [type === 'container' ? 'ps' : type, ...(type === 'container' ? ['-aq'] : ['ls', '-q']), '--filter', 'label=com.docker.compose.project=' + fixture], root));
  results.push({ id: 'owned-cleanup', exitCode: down.status === 0 && leftover.every((r) => r.status === 0 && r.stdout.trim() === '') ? 0 : 1 });
  if (originalPassword === undefined) delete process.env.RIDHUAN_DB_PASSWORD; else process.env.RIDHUAN_DB_PASSWORD = originalPassword;
  if (!resolve(scratch).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid owned cleanup directory'); await rm(scratch, { recursive: true, force: true }); await writeFile(join(logs, 'results.json'), JSON.stringify(results, null, 2));
}
const failed = interrupted || results.some((r) => r.exitCode !== 0); console.log(`laravel/${provider} Compose: ${failed ? 'FAILED' : 'PASSED'}; ${logs}`); process.exitCode = failed ? 1 : 0;
