import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { assertLocalStatus, assertLocalTestEnvironment } from './runtime-target.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export async function localTestPreflight() {
  const files = [];
  for (const filename of [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
    '.env.test',
    '.env.test.local',
    '.env.development',
    '.env.development.local',
  ]) {
    try {
      files.push(await readFile(path.join(repositoryRoot, 'apps/web', filename), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Unable to inspect application test environment files.');
    }
  }
  assertLocalTestEnvironment(process.env, files);
  let status;
  try {
    status = JSON.parse(await readFile(path.join(repositoryRoot, '.local/infra/status.json'), 'utf8'));
  } catch {
    throw new Error('Local tests require verified local Supabase status. Run npm run setup:local first.');
  }
  return assertLocalStatus(status, { requireDatabase: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  localTestPreflight().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Local test preflight failed.');
    process.exitCode = 1;
  });
}
