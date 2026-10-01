import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { command } from '../dist/process.js';
import { replaceEnv } from '../dist/scaffold/env.js';
import pg from 'pg';
import mysql from 'mysql2/promise';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(18000 + Math.floor(Math.random() * 10000), '127.0.0.1', resolve); });
  const address = server.address(); assert(address && typeof address === 'object');
  await new Promise(resolve => server.close(resolve)); return address.port;
}
function value(text, key) {
  const encoded = text.split(/\r?\n/).find(line => line.startsWith(key + '='))?.slice(key.length + 1);
  assert(encoded !== undefined, `Missing ${key}`);
  return encoded.startsWith("'") && encoded.endsWith("'") ? encoded.slice(1, -1).replaceAll("\\'", "'") : encoded;
}

export async function verifyManual(project, id, provider = 'postgresql') {
  const databasePort = await freePort(), apiPort = await freePort();
  const container = 'ridhuan-manual-' + randomUUID().slice(0, 8);
  const password = `manual #$ apostrophe' quote" slash\\ 日本;`;
  const original = await readFile(join(project, '.env'), 'utf8');
  const database = value(original, provider === 'mysql' ? 'MYSQL_DATABASE' : 'POSTGRES_DB'), user = value(original, provider === 'mysql' ? 'MYSQL_USER' : 'POSTGRES_USER');
  const url = `${provider}://${encodeURIComponent(user)}:${encodeURIComponent(password).replaceAll("'", '%27')}@127.0.0.1:${databasePort}/${database}${id === 'fastapi' ? '' : '?sslmode=disable'}`;
  const connection = provider === 'mysql' ? `Server="127.0.0.1";Port=${databasePort};Database="${database}";User ID="${user}";Password="${password.replaceAll('"', '""')}";SslMode=Preferred` : `Host="127.0.0.1";Port=${databasePort};Database="${database}";Username="${user}";Password="${password.replaceAll('"', '""')}"`;
  const replacements = id === 'dotnet'
    ? { Database__ConnectionString: connection, ASPNETCORE_URLS: `http://127.0.0.1:${apiPort}`, APP_PORT: String(apiPort) }
    : { DATABASE_URL: url, PORT: String(apiPort), APP_PORT: String(apiPort) };
  const fixtureEnv = replaceEnv(original, replacements);
  await writeFile(join(project, '.env'), fixtureEnv);
  const assigned = new Set([...fixtureEnv.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map(match => match[1]));
  // Read the generated .env through the application's loader, without unrelated host overrides.
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !assigned.has(key)));
  childEnv.GOWORK = 'off'; childEnv.GOMAXPROCS = '2'; childEnv.GOMEMLIMIT = '512MiB';
  function run(executable, args) {
    const result = spawnSync(executable, args, { cwd: project, env: childEnv, encoding: 'utf8', shell: false, windowsHide: true });
    assert.equal(result.status, 0, `${executable} manual command failed (output withheld to protect env values)`);
  }
  let server;
  try {
    const dockerArgs = provider === 'mysql' ? ['-p', `127.0.0.1:${databasePort}:3306`, '-e', `MYSQL_USER=${user}`, '-e', `MYSQL_PASSWORD=${password}`, '-e', `MYSQL_DATABASE=${database}`, '-e', 'MYSQL_ROOT_PASSWORD=disposable-root-password', '--mount', `type=bind,source=${join(project,'scripts/mysql-entrypoint.sh')},target=/opt/template/mysql-entrypoint.sh,readonly`, '--mount', `type=bind,source=${join(project,'scripts/mysql-init-user.sh')},target=/docker-entrypoint-initdb.d/10-app-user.sh,readonly`, '--entrypoint', '/bin/bash', 'mysql:8.4', '/opt/template/mysql-entrypoint.sh', 'mysqld'] : ['-p', `127.0.0.1:${databasePort}:5432`, '-e', `POSTGRES_USER=${user}`, '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${database}`, 'postgres:18.3-alpine'];
    const created = command('docker', ['run', '-d', '--name', container, ...dockerArgs], project);
    if(created.status!==0) throw new Error('Disposable database startup failed: '+created.stderr);
    let connected = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (provider === 'mysql') {
        let probe;
        try { probe = await mysql.createConnection({host:'127.0.0.1', port:databasePort, user, password, database, connectTimeout:1500}); await probe.query('SELECT 1'); connected=true; break; }
        catch { await pause(500); } finally { probe?.destroy(); }
        continue;
      }
      const probe = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
      try { await probe.connect(); await probe.query('SELECT 1'); connected = true; break; }
      catch { await pause(500); } finally { await probe.end(); }
    }
    assert(connected, 'Disposable database did not become ready');
    let executable, args;
    if (id === 'dotnet') {
      const loader = process.platform === 'win32' ? 'pwsh' : 'python3';
      const prefix = process.platform === 'win32' ? ['-File', 'scripts/run.ps1'] : ['scripts/run.py'];
      run(loader, [...prefix, 'run', '--project', 'tools/VerifiedApi.Migrator', '--no-restore']);
      run(loader, [...prefix, 'run', '--project', 'tools/VerifiedApi.Seeder', '--no-restore']);
      executable = loader; args = prefix;
    } else if (id === 'golang') {
      run('go', ['run', './cmd/migrate']); run('go', ['run', './cmd/seed']);
      const binary = join(project, process.platform === 'win32' ? '.tmp-manual-api.exe' : '.tmp-manual-api');
      run('go', ['build', '-p', '1', '-o', binary, './cmd/api']); executable = binary; args = [];
    } else if (id === 'fastapi') {
      run('uv', ['run', '--locked', 'backend', 'migrate']);
      run('uv', ['run', '--locked', 'backend', 'revision', 'consumer_generated_modules']);
      run('uv', ['run', '--locked', 'backend', 'migrate']);
      run('uv', ['run', '--locked', 'backend', 'check-migrations']);
      run('uv', ['run', '--locked', 'python', 'scripts/verify.py']);
      run('uv', ['run', '--locked', 'backend', 'seed']);
      executable = join(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      args = ['-m', 'app.cli.main', 'serve'];
    } else {
      // Use npm's executable resolved by the CLI; no Windows shell command construction.
      for (const script of ['prisma:migrate:deploy', 'seed']) {
        const saved = Object.fromEntries([...assigned].map(key => [key, process.env[key]]));
        for (const key of assigned) delete process.env[key];
        try { assert.equal(command('npm', ['run', script], project).status, 0, `Manual ${script} failed`); }
        finally { for (const [key, current] of Object.entries(saved)) { if (current === undefined) delete process.env[key]; else process.env[key] = current; } }
      }
      executable = process.execPath; args = [id === 'nestjs' ? 'dist/main.js' : 'dist/server.js'];
    }
    server = spawn(executable, args, { cwd: project, env: childEnv, stdio: 'ignore', shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    server.on('error', () => {});
    const origin = `http://127.0.0.1:${apiPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try { if ((await fetch(origin + '/ready', { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
      if (server.exitCode !== null) break;
      await pause(500);
    }
    assert(ready, 'Manual API/env loader failed readiness');
    assert((await fetch(origin + '/live')).ok);
    assert((await fetch(origin + '/docs/openapi.json')).ok);
    const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: value(fixtureEnv, id === 'dotnet' ? 'Bootstrap__Email' : 'ADMIN_EMAIL'), password: value(fixtureEnv, id === 'dotnet' ? 'Bootstrap__Password' : 'ADMIN_PASSWORD') }) });
    assert.equal(login.status, 200, 'Manual bootstrap login failed');
    const tokens = (await login.json()).data; assert(tokens[id === 'dotnet' ? 'accessToken' : 'token']);
    if (id === 'fastapi') {
      for (const module of ['consumer_example', 'settings']) {
        const response = await fetch(origin + '/api/' + module, { headers: { authorization: `Bearer ${tokens.token}` } });
        assert.equal(response.status, 200, 'Generated FastAPI module failed after its migration');
        assert.deepEqual((await response.json()).data, []);
      }
    }
    console.log(`${id}/${provider}: manual migration, explicit seed, env loader, chosen port, health/docs and login passed`);
  } finally {
    if (server?.pid) {
      if (process.platform === 'win32') command('taskkill', ['/PID', String(server.pid), '/T', '/F'], project);
      else {
        // Stop the API and loader together, using only this fixture's process group.
        try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
    command('docker', ['rm', '-f', '-v', container], project);
  }
}
