import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { assertLocalServicesReady, captureLocalStatus, repositoryRoot } from './local-stack.mjs';
import { localTestPreflight } from './test-preflight.mjs';

try {
  await localTestPreflight();
  await assertLocalServicesReady(await captureLocalStatus());
  const databaseTests = (await readdir(path.join(repositoryRoot, 'tests'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts') && entry.name.includes('database'))
    .map((entry) => `tests/${entry.name}`)
    .sort();
  if (!databaseTests.length) throw new Error('No database integration test files were found.');
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...databaseTests], {
    cwd: repositoryRoot,
    env: { ...process.env, ROOMSELL_RUN_DATABASE_TESTS: '1' },
    stdio: 'inherit',
  });
  child.on('error', () => {
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database tests require running local services.');
  process.exitCode = 1;
}
