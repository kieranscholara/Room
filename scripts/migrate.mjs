import console from 'node:console';
import process from 'node:process';
import { assertLocalServicesReady, captureLocalStatus, runLocalCli } from './local-stack.mjs';

async function migrate() {
  const status = await captureLocalStatus();
  await assertLocalServicesReady(status);
  console.log('Applying pending migrations to the local database.');
  // The official CLI owns the supabase_migrations ledger; never reset user data.
  await runLocalCli(['migration', 'up', '--local', '--yes'], 'migrate.log');
  console.log('Local database migrations are up to date.');
}

migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Local database migration failed.');
  process.exitCode = 1;
});
