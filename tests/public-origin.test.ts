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
  it('uses the browser loopback host instead of the internal bind address', () => {
    target.local = true;
    const local = {
      nextUrl: new URL('http://0.0.0.0:3100/api/auth/recover'),
      headers: new Headers({ host: '127.0.0.1:3100' }),
    } as unknown as NextRequest;
    expect(applicationOrigin(local)).toBe('http://127.0.0.1:3100');
  });
  it.each([
    'untrusted.example',
    'user:secret@localhost:3000',
    'localhost:3000/path',
    'localhost:3000?next=elsewhere',
  ])('rejects an untrusted local host %s', (host) => {
    target.local = true;
    expect(() =>
      applicationOrigin({
        nextUrl: new URL('http://0.0.0.0:3100'),
        headers: new Headers({ host }),
      } as unknown as NextRequest),
    ).toThrow();
  });
});
