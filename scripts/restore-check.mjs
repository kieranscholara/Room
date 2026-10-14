import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { localTestPreflight } from './test-preflight.mjs';
const directory = process.argv[2];
if (!directory) throw new Error('Pass the local backup directory.');
const status = await localTestPreflight();
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
if (manifest.version !== 1) throw new Error('Unsupported backup manifest.');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const dump = await readFile(path.join(directory, 'database.dump'));
if (digest(dump) !== manifest.database.sha256) throw new Error('Database backup checksum mismatch.');
const name = 'roomsell_restore_' + randomUUID().replaceAll('-', ''),
  bucket = 'restore-drill-' + randomUUID();
const db = new Client({ connectionString: status.DB_URL });
await db.connect();
const container = execFileSync(
  'docker',
  ['ps', '--filter', 'name=^supabase_db_roomsell-ai$', '--format', '{{.Names}}'],
  { encoding: 'utf8' },
).trim();
if (container !== 'supabase_db_roomsell-ai') throw new Error('Verified local database container required.');
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let restore,
  databaseCreated = false,
  bucketCreated = false;
const uploaded = [];
try {
  await db.query('create database ' + name + ' template template0');
  databaseCreated = true;
  const url = new URL(status.DB_URL);
  url.pathname = '/' + name;
  restore = new Client({ connectionString: url.toString() });
  await restore.connect();
  await restore.query(
    'drop schema public cascade;create schema extensions;create extension pgcrypto with schema extensions;',
  );
  const file = await open(path.join(directory, 'database.dump'), 'r');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'exec',
          '-i',
          container,
          'pg_restore',
          '-U',
          'postgres',
          '-d',
          name,
          '--no-owner',
          '--no-privileges',
          '--exit-on-error',
        ],
        { stdio: [file.fd, 'ignore', 'pipe'] },
      );
      let error = '';
      child.stderr.on('data', (chunk) => {
        if (error.length < 2000) error += chunk.toString();
      });
      child.on('error', () => reject(new Error('Isolated restore command unavailable.')));
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              'Isolated database restore failed: ' +
                error.replace(/postgresql:\/\/[^\s]+/g, '[redacted]').slice(0, 1000),
            ),
          );
      });
    });
  } finally {
    await file.close();
  }
  for (const [table, count] of Object.entries(manifest.counts)) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid manifest table.');
    const actual = Number((await restore.query('select count(*) as n from public.' + table)).rows[0].n);
    if (actual !== count) throw new Error('Restored table count mismatch: ' + table);
  }
  const created = await admin.storage.createBucket(bucket, { public: false, fileSizeLimit: 52428800 });
  if (created.error) throw new Error('Isolated asset restore bucket unavailable.');
  bucketCreated = true;
  for (const object of manifest.objects) {
    if (!/^[0-9a-f]{64}\.asset$/.test(object.file)) throw new Error('Invalid backup asset path.');
    const bytes = await readFile(path.join(directory, object.file));
    if (digest(bytes) !== object.sha256) throw new Error('Backup asset checksum mismatch.');
    const target = object.file;
    const written = await admin.storage
      .from(bucket)
      .upload(target, bytes, { contentType: object.contentType, upsert: false });
    if (written.error) throw new Error('Isolated asset restore failed.');
    uploaded.push(target);
    const fetched = await admin.storage.from(bucket).download(target);
    if (
      fetched.error ||
      !fetched.data ||
      digest(Buffer.from(await fetched.data.arrayBuffer())) !== object.sha256
    )
      throw new Error('Restored asset bytes differ.');
  }
  console.log(
    JSON.stringify({
      restoredTables: Object.keys(manifest.counts).length,
      restoredAssets: uploaded.length,
      isolated: true,
      originalDataUnchanged: true,
    }),
  );
} finally {
  if (uploaded.length) await admin.storage.from(bucket).remove(uploaded);
  if (bucketCreated) await admin.storage.deleteBucket(bucket);
  if (restore) await restore.end();
  if (databaseCreated) await db.query('drop database if exists ' + name + ' with (force)');
  await db.end();
}
