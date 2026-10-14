import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
const target = vi.hoisted(() => ({ local: false }));
vi.mock('server-only', () => ({}));
vi.mock('../apps/web/lib/supabase-config', () => ({ supabaseConfig: () => target }));
import { applicationOrigin } from '../apps/web/lib/public-origin';
const request = { nextUrl: new URL('http://untrusted.example') } as unknown as NextRequest;
afterEach(() => {
  vi.unstubAllEnvs();
  target.local = false;
});
describe('hosted authentication origin', () => {
  it('uses only the configured HTTPS origin in hosted mode', () => {
    vi.stubEnv('ROOMSELL_PUBLIC_ORIGIN', 'https://roomsell.example/');
    expect(applicationOrigin(request)).toBe('https://roomsell.example');
  });
  it('fails closed when the hosted origin is absent', () => {
    vi.stubEnv('ROOMSELL_PUBLIC_ORIGIN', '');
    expect(() => applicationOrigin(request)).toThrow(/Configure the public/);
  });
  it.each([
    'http://roomsell.example',
    'https://roomsell.example/other',
    'https://user:password@roomsell.example',
    'https://roomsell.example/?redirect=bad',
    'https://roomsell.example/#bad',
    'malformed',
  ])('rejects an unsafe origin: %s', (origin) => {
    vi.stubEnv('ROOMSELL_PUBLIC_ORIGIN', origin);
    expect(() => applicationOrigin(request)).toThrow();
  });
  it('preserves the verified local development origin', () => {
    target.local = true;
    expect(applicationOrigin(request)).toBe('http://untrusted.example');
  });
});
