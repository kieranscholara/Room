import { Buffer } from 'node:buffer';
import { spawn, execFileSync } from 'node:child_process';
import { open, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import console from 'node:console';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { localTestPreflight } from './test-preflight.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const status = await localTestPreflight();
const container = execFileSync(
  'docker',
  ['ps', '--filter', 'name=^supabase_db_roomsell-ai$', '--format', '{{.Names}}'],
  { encoding: 'utf8' },
).trim();
if (container !== 'supabase_db_roomsell-ai')
  throw new Error('The verified local database container is required.');
const directory = path.join(root, '.local/backups', new Date().toISOString().replaceAll(':', '-'));
await mkdir(directory, { recursive: true, mode: 0o700 });
const output = await open(path.join(directory, 'database.dump'), 'wx', 0o600),
  db = new Client({ connectionString: status.DB_URL });
await db.connect();
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  await db.query('begin isolation level repeatable read');
  const snapshot = (await db.query('select pg_export_snapshot() as id')).rows[0].id;
  const tables = (
    await db.query(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name",
    )
  ).rows;
  const counts = {};
  for (const { table_name: name } of tables) {
    if (!/^[a-z_]+$/.test(name)) throw new Error('Unsupported table name.');
    counts[name] = Number((await db.query('select count(*) as n from public.' + name)).rows[0].n);
  }
  const objects = (
    await db.query('select bucket_id,name,metadata from storage.objects order by bucket_id,name')
  ).rows;
  await new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        container,
        'pg_dump',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--schema=public',
        '--schema=auth',
        '--schema=storage',
        '--schema=supabase_migrations',
        '--snapshot=' + snapshot,
      ],
      { stdio: ['ignore', output.fd, 'ignore'] },
    );
    child.on('error', () => reject(new Error('Local database export unavailable.')));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Local database export failed.'))));
  });
  await output.close();
  const assets = [];
  for (const object of objects) {
    const response = await admin.storage.from(object.bucket_id).download(object.name);
    if (response.error || !response.data)
      throw new Error('An asset changed during backup; retry with a quiet dataset.');
    const bytes = Buffer.from(await response.data.arrayBuffer()),
      file = digest(Buffer.from(object.bucket_id + '\0' + object.name)) + '.asset';
    await writeFile(path.join(directory, file), bytes, { flag: 'wx', mode: 0o600 });
    assets.push({
      bucket: object.bucket_id,
      name: object.name,
      file,
      sha256: digest(bytes),
      contentType: object.metadata?.mimetype ?? 'application/octet-stream',
    });
  }
  await db.query('commit');
  const { readFile } = await import('node:fs/promises');
  const dump = await readFile(path.join(directory, 'database.dump'));
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    counts,
    database: { file: 'database.dump', sha256: digest(dump) },
    objects: assets,
  };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify({ backup: directory, tables: tables.length, assets: assets.length }));
} finally {
  await db.end();
  await output.close().catch(() => {});
}
