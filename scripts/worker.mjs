import { URL } from 'node:url';
const { fetch, AbortSignal, setTimeout } = globalThis;
import process from 'node:process';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { localTestPreflight } from './test-preflight.mjs';
const watch = process.argv.includes('--watch');
const endpoint = process.env.ROOMSELL_WORKER_URL || 'http://127.0.0.1:3000/api/internal/jobs/run';
const url = new URL(endpoint);
let token = process.env.ROOMSELL_WORKER_TOKEN || process.env.CRON_SECRET;
if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
  await localTestPreflight();
  token ||= await readFile(new URL('../.local/fixtures/worker-token', import.meta.url), 'utf8');
} else if (url.protocol !== 'https:' || url.username || url.password)
  throw new Error('Hosted workers require an explicit HTTPS endpoint.');
if (!token || token.length < 32) throw new Error('Configure the worker token securely.');
do {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(65000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Worker request failed with HTTP ' + response.status);
    const result = await response.json();
    if (result.processed) console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Worker unavailable.');
    if (!watch) process.exitCode = 1;
  }
  if (watch) await new Promise((resolve) => setTimeout(resolve, 2000));
} while (watch);
