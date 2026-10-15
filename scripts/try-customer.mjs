import { spawn } from 'node:child_process';
import { access, appendFile, chmod, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { localTestPreflight } from './test-preflight.mjs';

const { fetch, AbortSignal, setTimeout } = globalThis;
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.local/runtime');
const npmCli = process.env.npm_execpath;
const children = [];
let stopping = false;
const environment = {
  ...process.env,
  ROOMSELL_LOCAL_SUPABASE: '1',
  ROOMSELL_ENABLE_DEMO: '1',
  ROOMSELL_ENABLE_TEST_CUSTOMER: '1',
  ROOMSELL_TEST_FIXTURE_SET: '',
  ROOMSELL_TEST_BASE_URL: 'http://127.0.0.1:3000',
  ROOMSELL_WORKER_URL: 'http://127.0.0.1:3000/api/internal/jobs/run',
};
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: 'inherit' });
    child.once('error', () => reject(new Error('Could not start ' + path.basename(command))));
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(path.basename(command) + ' exited with code ' + code)),
    );
  });
}
async function localStatus(route) {
  try {
    return await fetch('http://127.0.0.1:3000' + route, {
      signal: AbortSignal.timeout(2000),
      redirect: 'error',
    });
  } catch {
    return null;
  }
}
async function launch(name, args) {
  const logPath = path.join(runtime, name + '.log');
  const log = await open(logPath, 'a', 0o600);
  await chmod(logPath, 0o600);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: environment,
    detached: process.platform !== 'win32',
    stdio: ['ignore', log.fd, log.fd],
  });
  child.once('error', () => console.error(name + ' could not start. Inspect its private runtime log.'));
  children.push(child);
  await log.close();
  if (!child.pid) throw new Error(name + ' could not start.');
  await writeFile(path.join(runtime, name + '.pid'), String(child.pid) + '\n', { mode: 0o600 });
  return child;
}
async function workerRunning() {
  try {
    const pid = Number((await readFile(path.join(runtime, 'worker.pid'), 'utf8')).trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    // Reuse only a verified worker. Never signal a process just because a PID file exists.
    if (process.platform !== 'linux') return false;
    const command = await readFile('/proc/' + pid + '/cmdline', 'utf8');
    return command.includes('scripts/worker.mjs') || command.includes('npm run worker');
  } catch {
    return false;
  }
}
async function cleanup() {
  for (const child of children.reverse()) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (process.platform === 'win32') await run('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* An owned process may already have exited. */
    }
  }
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  await cleanup();
  process.exit(code);
}
process.once('SIGINT', () => void stop(130));
process.once('SIGTERM', () => void stop(143));

try {
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error('Install Node.js 24, then run npm run try:customer again.');
  if (!npmCli) throw new Error('Start this workflow with npm run try:customer.');
  console.log('Preparing Boreal Living: fictional retailer, customer, images and inventory.');
  console.log('Docker Desktop/Engine must be running. No hosted account or email verification is needed.');
  await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  try {
    await access(path.join(root, 'node_modules/next/package.json'));
  } catch {
    await run(process.execPath, [npmCli, 'ci', '--cache', path.join(root, '.local/npm-cache')]);
  }
  await run(process.execPath, ['scripts/local-stack.mjs']);
  await localTestPreflight();
  await run(process.execPath, ['scripts/migrate.mjs']);
  const envFile = path.join(root, 'apps/web/.env.local');
  const source = await readFile(envFile, 'utf8');
  let additions = '';
  if (!/^ROOMSELL_ENABLE_TEST_CUSTOMER=/m.test(source)) additions += 'ROOMSELL_ENABLE_TEST_CUSTOMER=1\n';
  const keyFile = path.join(root, '.local/fixtures/connector-key');
  await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  const configuredKey = /^ROOMSELL_CONNECTOR_ENCRYPTION_KEY=(.+)$/m.exec(source)?.[1]?.trim();
  if (!environment.ROOMSELL_CONNECTOR_ENCRYPTION_KEY) {
    let retainedKey;
    try {
      retainedKey = (await readFile(keyFile, 'utf8')).trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (configuredKey && retainedKey && configuredKey !== retainedKey)
      throw new Error(
        'Local connector key differs from retained trial state; restore its matching private configuration.',
      );
    const key = configuredKey || retainedKey || randomBytes(32).toString('base64');
    if (!retainedKey) await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
    if (!configuredKey) additions += 'ROOMSELL_CONNECTOR_ENCRYPTION_KEY=' + key + '\n';
  }
  if (additions) await appendFile(envFile, (source.endsWith('\n') ? '' : '\n') + additions);
  await chmod(envFile, 0o600);
  await mkdir(runtime, { recursive: true, mode: 0o700 });

  const existing = await localStatus('/api/health');
  if (existing) {
    const test = await localStatus('/api/testing/status');
    if (!existing.ok || !test || ![200, 503].includes(test.status))
      throw new Error(
        'Port 3000 is occupied by an app without local testing enabled. Stop that app first; it was left untouched.',
      );
    if (test.ok) {
      const profile = JSON.parse(await readFile(path.join(root, '.local/fixtures/boreal.json'), 'utf8'));
      if ((await test.json()).organisationId !== profile.organisationId)
        throw new Error('Port 3000 belongs to another test fixture. It was left untouched.');
    }
    console.log('Reusing the healthy local test application.');
  } else {
    console.log('Starting the app; its first compilation may take a moment.');
    const app = await launch('app', [npmCli, 'run', 'dev', '--', '--port', '3000']);
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (app.exitCode !== null) break;
      if ((await localStatus('/api/health'))?.ok) {
        healthy = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!healthy) throw new Error('App startup failed. Inspect .local/runtime/app.log locally.');
  }
  await run(process.execPath, ['scripts/seed-test-customer.mjs']);
  if (!(await workerRunning())) await launch('worker', ['scripts/worker.mjs', '--watch']);
  await run(process.execPath, ['scripts/worker.mjs']);
  console.log(
    '\nREADY: local app on port 3000. Open /testing and click Enter as retailer or Enter as customer.',
  );
  console.log(
    'No signup, password entry or email verification. Select the labelled local test AI adapter to test without API keys.',
  );
  if (children.length) {
    console.log(
      'Keep this terminal open. Ctrl+C stops only the app/worker started by this command; saved data remains.',
    );
    await new Promise((resolve) => {
      for (const child of children)
        child.once('exit', () => {
          if (!stopping) {
            console.error('A local app/worker stopped. Inspect its private runtime log.');
            process.exitCode = 1;
          }
          resolve();
        });
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Fictional customer startup failed.');
  process.exitCode = 1;
} finally {
  await cleanup();
}
