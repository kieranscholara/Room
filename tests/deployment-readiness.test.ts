import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { deploymentChecks } from '../scripts/deployment-check.mjs';

function configured() {
  return {
    SUPABASE_URL: 'https://project.supabase.co',
    ROOMSELL_PUBLIC_ORIGIN: 'https://roomsell.example',
    SUPABASE_ANON_KEY: 'fictional-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'fictional-service',
    ROOMSELL_CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    CRON_SECRET: randomBytes(32).toString('base64url'),
    ROOMSELL_AI_API_KEY: 'fictional-config-check-only',
  } as Record<string, string>;
}
describe('managed deployment configuration gate', () => {
  it('accepts complete bindings without exposing their values', () => {
    const env = configured(),
      checks = deploymentChecks(env);
    expect(checks.every((check) => check.passed)).toBe(true);
    for (const secret of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'ROOMSELL_CONNECTOR_ENCRYPTION_KEY',
      'CRON_SECRET',
      'ROOMSELL_AI_API_KEY',
    ])
      expect(JSON.stringify(checks)).not.toContain(env[secret]);
  });
  it.each(['ROOMSELL_ENABLE_TEST_CUSTOMER', 'ROOMSELL_ENABLE_DEMO', 'ROOMSELL_LOCAL_SUPABASE'])(
    'blocks hosted release with %s enabled',
    (flag) => {
      const env = { ...configured(), [flag]: '1' };
      expect(deploymentChecks(env).some((check) => !check.passed)).toBe(true);
    },
  );
  it.each([
    'http://roomsell.example',
    'https://roomsell.example/path',
    'https://user:secret@roomsell.example',
    'https://localhost',
    'https://boreal.test',
  ])('rejects invalid public origins %s', (url) => {
    expect(
      deploymentChecks({ ...configured(), ROOMSELL_PUBLIC_ORIGIN: url }).some((check) => !check.passed),
    ).toBe(true);
  });
  it('rejects absent, short, conflated or mismatched credentials', () => {
    for (const override of [
      { CRON_SECRET: 'short' },
      { ROOMSELL_WORKER_TOKEN: 'x'.repeat(32) },
      { ROOMSELL_CONNECTOR_ENCRYPTION_KEY: 'invalid' },
      { ROOMSELL_AI_API_KEY: '' },
      { SUPABASE_SERVICE_ROLE_KEY: 'fictional-anon' },
    ])
      expect(deploymentChecks({ ...configured(), ...override }).some((check) => !check.passed)).toBe(true);
  });
});
