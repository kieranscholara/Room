import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { localTestPreflight } from './scripts/test-preflight.mjs';
await localTestPreflight();
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: {
    command: 'npm run start -- --port 3100',
    url: 'http://127.0.0.1:3100/api/scene',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ROOMSELL_DATA_DIR: '../../.local/e2e',
      ROOMSELL_LOCAL_SUPABASE: '1',
      ROOMSELL_ENABLE_DEMO: '1',
      ROOMSELL_CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    },
  },
});
