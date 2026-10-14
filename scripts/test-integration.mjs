import { spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { assertLocalServicesReady, captureLocalStatus, repositoryRoot } from './local-stack.mjs';

try {
  await assertLocalServicesReady(await captureLocalStatus());
  const child = spawn(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', 'tests/database-security.test.ts'],
    { cwd: repositoryRoot, env: { ...process.env, ROOMSELL_RUN_DATABASE_TESTS: '1' }, stdio: 'inherit' },
  );
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
