import { execFileSync } from 'node:child_process';
import { mkdir, lstat, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { localTestPreflight } from '../../scripts/test-preflight.mjs';
export default async function setup() {
  await localTestPreflight();
  if (process.env.ROOMSELL_TEST_FIXTURE_SET !== 'browser')
    throw new Error('Browser setup requires its isolated fixture set.');
  // Give each acceptance run its own retailer/actor quota and stock history.
  // Preserve previous disposable credentials and data for diagnostics; never touch the interactive trial.
  const directory = resolve('.local/e2e-fixtures');
  let archive: string | undefined;
  for (const name of ['boreal.json', 'boreal-stock.json', 'boreal-supplier-orders.json']) {
    const file = resolve(directory, name);
    try {
      const info = await lstat(file);
      if (!info.isFile()) throw new Error('Browser fixture records must be regular local files.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!archive) {
      archive = resolve('.local/e2e-archives', `${Date.now()}-${randomUUID()}`);
      await mkdir(archive, { recursive: true, mode: 0o700 });
    }
    await rename(file, resolve(archive, name));
  }
  execFileSync(process.execPath, ['scripts/seed-test-customer.mjs'], {
    env: { ...process.env, ROOMSELL_TEST_BASE_URL: 'http://127.0.0.1:3100', ROOMSELL_LOCAL_SUPABASE: '1' },
    stdio: 'pipe',
  });
}
