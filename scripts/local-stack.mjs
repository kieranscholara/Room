import { spawn } from 'node:child_process';
import console from 'node:console';
import { access, chmod, mkdir, open, readFile, rename, statfs, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { setInterval, clearInterval } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const infrastructureDirectory = path.join(repositoryRoot, '.local', 'infra');
const cliPath = path.join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const minimumFreeBytes = 3 * 1024 ** 3;
const optionalServices = 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function prepareLocalCli() {
  if (!(await exists(cliPath))) {
    throw new Error('Supabase CLI is missing. Run npm ci before starting local services.');
  }
  await mkdir(infrastructureDirectory, { recursive: true, mode: 0o700 });
  await chmod(infrastructureDirectory, 0o700);
  const dockerDirectory = path.join(infrastructureDirectory, 'docker');
  await mkdir(dockerDirectory, { recursive: true, mode: 0o700 });
  await chmod(dockerDirectory, 0o700);
  const dockerConfiguration = path.join(dockerDirectory, 'config.json');
  if (!(await exists(dockerConfiguration))) {
    // Docker's default injected proxy breaks BusyBox probes of container loopback.
    // This separate client profile changes only local container proxy injection;
    // daemon registry networking, TLS checks, and the user's Docker config stay intact.
    await writeFile(
      dockerConfiguration,
      JSON.stringify({ proxies: { default: { noProxy: '127.0.0.1,localhost,::1' } } }, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  }
  await chmod(dockerConfiguration, 0o600);
  return {
    ...process.env,
    DOCKER_CONFIG: dockerDirectory,
    SUPABASE_HOME: path.join(infrastructureDirectory, 'cli'),
    SUPABASE_PROJECT_ID: 'roomsell-ai',
    SUPABASE_TELEMETRY_DISABLED: '1',
    SUPABASE_INTERNAL_IMAGE_REGISTRY: 'docker.io',
    SUPABASE_USE_SLIM_IMAGES: '1',
  };
}

export async function runLocalCli(args, logName, { stdoutFile } = {}) {
  const environment = await prepareLocalCli();
  const logPath = path.join(infrastructureDirectory, logName);
  const log = await open(logPath, 'w', 0o600);
  await log.chmod(0o600);
  const output = stdoutFile ? await open(stdoutFile, 'w', 0o600) : log;
  if (output !== log) await output.chmod(0o600);
  let diskError;
  let diskTimer;
  let child;
  const interrupt = () => child?.kill('SIGINT');
  const terminate = () => child?.kill('SIGTERM');
  try {
    if (args[0] === 'start') {
      const filesystem = await statfs(repositoryRoot);
      if (filesystem.bavail * filesystem.bsize < minimumFreeBytes) {
        throw new Error('Local stack startup needs at least 3 GiB of free disk space.');
      }
    }
    const result = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [cliPath, ...args], {
        cwd: repositoryRoot,
        env: environment,
        stdio: ['ignore', output.fd, log.fd],
      });
      process.once('SIGINT', interrupt);
      process.once('SIGTERM', terminate);
      child.once('error', () => reject(new Error('Could not launch the installed Supabase CLI.')));
      child.once('close', (code, signal) => resolve({ code, signal }));
      if (args[0] === 'start') {
        diskTimer = setInterval(async () => {
          try {
            const filesystem = await statfs(repositoryRoot);
            if (filesystem.bavail * filesystem.bsize < minimumFreeBytes && !diskError) {
              diskError = new Error('Stopped local stack startup: less than 3 GiB disk space remains.');
              child.kill('SIGINT');
            }
          } catch {
            // Startup still retains the CLI's own exit status if disk monitoring is unavailable.
          }
        }, 5000);
      }
    });
    if (diskError) throw diskError;
    if (result.code !== 0) {
      throw new Error(
        `Supabase command failed (${result.signal ?? `exit ${result.code}`}). Inspect .local/infra/${logName} locally; it may contain credentials.`,
      );
    }
  } finally {
    if (diskTimer) clearInterval(diskTimer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    await log.close();
    if (output !== log) await output.close();
  }
}

export async function captureLocalStatus() {
  const filename = path.join(infrastructureDirectory, 'status.json');
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await runLocalCli(['status', '-o', 'json'], 'status.log', { stdoutFile: temporary });
  let status;
  let api;
  try {
    status = JSON.parse(await readFile(temporary, 'utf8'));
    api = typeof status.API_URL === 'string' ? new URL(status.API_URL) : null;
  } catch {
    throw new Error('Could not read local Supabase status. Run npm run setup:local again.');
  }
  if (
    !api ||
    api.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(api.hostname) ||
    api.port !== '54321' ||
    typeof status.ANON_KEY !== 'string' ||
    !status.ANON_KEY ||
    typeof status.SERVICE_ROLE_KEY !== 'string' ||
    !status.SERVICE_ROLE_KEY
  ) {
    throw new Error('Local Supabase status is incomplete or does not identify this local stack.');
  }
  await rename(temporary, filename);
  return status;
}

export async function assertLocalServicesReady(status) {
  const endpoints = ['/auth/v1/health', '/storage/v1/status', '/rest/v1/'];
  for (const endpoint of endpoints) {
    const response = await globalThis.fetch(new URL(endpoint, status.API_URL), {
      headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${status.ANON_KEY}` },
      signal: globalThis.AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Local service readiness failed at ${endpoint}.`);
    if (endpoint === '/rest/v1/') {
      const schema = await response.json();
      if (!schema.paths) throw new Error('PostgREST did not return a valid API schema.');
    }
  }
}

async function configureLocalApplication() {
  const filename = path.join(repositoryRoot, 'apps', 'web', '.env.local');
  if (
    (await exists(filename)) ||
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  ) {
    console.log(
      'Existing application environment preserved. Set ROOMSELL_LOCAL_SUPABASE=1 to select this local stack.',
    );
    return;
  }
  await writeFile(filename, 'ROOMSELL_LOCAL_SUPABASE=1\n', { flag: 'wx', mode: 0o600 });
  console.log('Created apps/web/.env.local with the local development flag only.');
}

export async function startLocalStack() {
  console.log('Starting the local PostgreSQL, Auth, Storage, and API services.');
  await runLocalCli(['start', '--exclude', optionalServices, '--yes'], 'start.log');
  const status = await captureLocalStatus();
  await assertLocalServicesReady(status);
  await configureLocalApplication();
  console.log('Local Supabase is ready: API port 54321, PostgreSQL port 54322, local mail port 54324.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalStack().catch((error) => {
    // Never forward raw CLI output or local status contents to the terminal.
    console.error(error instanceof Error ? error.message : 'Local infrastructure startup failed.');
    process.exitCode = 1;
  });
}
