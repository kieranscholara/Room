import { describe, expect, it } from 'vitest';
import {
  assertLocalStatus,
  assertLocalTestEnvironment,
  selectSupabaseTarget,
} from '../scripts/runtime-target.mjs';

const status = {
  API_URL: 'http://127.0.0.1:54321',
  DB_URL: 'postgresql://local:private@127.0.0.1:54322/postgres',
  ANON_KEY: 'local-anonymous-fixture',
  SERVICE_ROLE_KEY: 'local-service-fixture',
};
const hosted = {
  SUPABASE_URL: 'https://hosted-fixture.example',
  SUPABASE_ANON_KEY: 'hosted-anonymous-fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'hosted-service-fixture',
};

describe('exclusive Supabase runtime and test targets', () => {
  it('selects only verified local status when hosted bindings are also present', () => {
    expect(selectSupabaseTarget({ ...hosted, ROOMSELL_LOCAL_SUPABASE: '1' }, status)).toEqual({
      url: status.API_URL,
      anonKey: status.ANON_KEY,
      serviceKey: status.SERVICE_ROLE_KEY,
      local: true,
    });
  });
  it('never falls back to hosted bindings when local status is missing or invalid', () => {
    for (const invalid of [undefined, {}, { ...status, SERVICE_ROLE_KEY: '' }]) {
      expect(() => selectSupabaseTarget({ ...hosted, ROOMSELL_LOCAL_SUPABASE: '1' }, invalid)).toThrow(
        'Local Supabase status',
      );
    }
  });
  it.each([
    'https://hosted-fixture.example',
    'http://127.0.0.1:54322',
    'http://127.0.0.1:54321.evil.example',
    'http://private@127.0.0.1:54321',
    'http://localhost:54321/other',
    'http://localhost:54321?redirect=remote',
  ])('rejects non-stack local API target %s', (url) => {
    expect(() => assertLocalStatus({ ...status, API_URL: url })).toThrow('Local Supabase status');
  });
  it('verifies the direct PostgreSQL target before integration writes', () => {
    expect(assertLocalStatus(status, { requireDatabase: true })).toBe(status);
    for (const DB_URL of [
      'postgresql://private@remote.example:54322/postgres',
      'postgresql://localhost:54321/postgres',
      'invalid',
    ]) {
      expect(() => assertLocalStatus({ ...status, DB_URL }, { requireDatabase: true })).toThrow();
    }
  });
  it('requires all hosted server bindings and HTTPS without mixing local values', () => {
    expect(selectSupabaseTarget(hosted, status).local).toBe(false);
    for (const invalid of [
      {},
      { ...hosted, SUPABASE_ANON_KEY: '' },
      { ...hosted, SUPABASE_URL: status.API_URL },
      { ...hosted, SUPABASE_URL: 'broken' },
    ]) {
      expect(() => selectSupabaseTarget(invalid, status)).toThrow('Hosted Supabase requires');
    }
  });
  it('fails test preflight on configured bindings without revealing credentials', () => {
    for (const [environment, files] of [
      [hosted, []],
      [
        { ROOMSELL_LOCAL_SUPABASE: '1' },
        ['SUPABASE_URL="https://hosted-fixture.example"\nSUPABASE_SERVICE_ROLE_KEY=private-fixture-secret'],
      ],
      [{}, ['export NEXT_PUBLIC_SUPABASE_URL=${REMOTE_TARGET}']],
    ] as const) {
      try {
        assertLocalTestEnvironment(environment, [...files]);
        throw new Error('Expected rejection');
      } catch (error) {
        expect((error as Error).message).toContain('Local tests refuse configured Supabase bindings');
        expect((error as Error).message).not.toMatch(/hosted-fixture|private-fixture-secret|REMOTE_TARGET/);
      }
    }
    expect(() =>
      assertLocalTestEnvironment({ ROOMSELL_LOCAL_SUPABASE: '1' }, [
        '# SUPABASE_URL=unused\nSUPABASE_URL=""\nSUPABASE_ANON_KEY=\n',
      ]),
    ).not.toThrow();
  });
});
