import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import pg from 'pg';

function value(env, key) {
  const encoded = env.split(/\r?\n/).find(line => line.startsWith(key + '='))?.slice(key.length + 1);
  assert(encoded !== undefined, `Missing ${key}`);
  return encoded.startsWith("'") ? encoded.slice(1, -1).replaceAll("\\'", "'") : encoded;
}

// Keep fixtures on a separate database; release jobs use its URL explicitly.
export async function verifyProviderUpgrade({ project, id, database, env, dbPort, dbPassword, run }) {
  const name = 'consumer_upgrade_' + randomUUID().replaceAll('-', '');
  const isMySQL = database === 'mysql';
  const rootPassword = isMySQL ? value(env, 'MYSQL_ROOT_PASSWORD') : dbPassword;
  const user = isMySQL ? 'root' : value(env, 'POSTGRES_USER');
  const settings = { host: '127.0.0.1', port: dbPort, user, password: rootPassword };
  const admin = isMySQL ? await mysql.createConnection({ ...settings, timezone: 'Z', database: 'mysql' }) : new pg.Client({ ...settings, database: 'postgres' });
  if (!isMySQL) await admin.connect();
  let connection;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    connection = isMySQL ? await mysql.createConnection({ ...settings, timezone: 'Z', database: name }) : new pg.Client({ ...settings, timezone: 'Z', database: name });
    if (!isMySQL) await connection.connect();
    const url = new URL(value(env, 'DATABASE_URL_DOCKER'));
    url.pathname = '/' + name;
    if (isMySQL) { url.username = 'root'; url.password = rootPassword; }
    const base = id === 'express-typescript' ? 'docker-compose.yml' : 'compose.yaml';
    const release = (...args) => run('docker', ['compose', '-f', base, '-f', '.tmp-consumer-ports.yaml', 'run', '--rm', '--no-deps', '-e', 'DATABASE_URL=' + url.toString(), '--entrypoint', ...args], project, false);
    if (id === 'fastapi') release('backend', 'migrate', 'migrate', '--revision', '0001');
    else if (id === 'golang') release('migrate', 'migrate', '--to-version', '1');
    else release('node', 'migrate', 'node_modules/prisma/build/index.js', 'migrate', 'deploy');
    const table = id === 'express-typescript' ? 'Role' : 'roles';
    const created = id === 'express-typescript' || id === 'nestjs' ? 'createdAt' : 'created_at';
    const updated = id === 'express-typescript' || id === 'nestjs' ? 'updatedAt' : 'updated_at';
    const quote = column => isMySQL ? '`' + column + '`' : '"' + column + '"';
    const params = isMySQL ? '?,?,?,?' : '$1,$2,$3,$4';
    const fixture = randomUUID();
    await connection.query(`INSERT INTO ${quote(table)} (id,name,${quote(created)},${quote(updated)}) VALUES (${params})`, [fixture, 'upgrade-fixture', '2026-01-01 00:00:00', '2026-01-01 00:00:00']);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (id === 'fastapi') release('backend', 'migrate', 'migrate');
      else if (id === 'golang') release('migrate', 'migrate');
      else release('node', 'migrate', 'node_modules/prisma/build/index.js', 'migrate', 'deploy');
    }
    const result = await connection.query(`SELECT name,${quote(created)} AS original_date FROM ${quote(table)} WHERE id=${isMySQL ? '?' : '$1'}`, [fixture]);
    const rows = isMySQL ? result[0] : result.rows;
    assert.equal(rows[0].name, 'upgrade-fixture');
    assert.equal(rows[0].original_date.toISOString(), '2026-01-01T00:00:00.000Z');
    await connection.query(`SELECT id FROM ${quote(id === 'express-typescript' ? 'Notification' : 'notifications')} LIMIT 0`);
    console.log(`${id}/${database}: migration preservation and repeat release passed`);
  } finally {
    await connection?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name}${isMySQL ? '' : ' WITH (FORCE)'}`);
    await admin.end();
  }
}
