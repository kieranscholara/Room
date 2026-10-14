import { execFileSync } from 'node:child_process';
export default async function setup() {
  execFileSync(process.execPath, ['scripts/seed-test-customer.mjs'], {
    env: { ...process.env, ROOMSELL_TEST_BASE_URL: 'http://127.0.0.1:3100', ROOMSELL_LOCAL_SUPABASE: '1' },
    stdio: 'pipe',
  });
}
