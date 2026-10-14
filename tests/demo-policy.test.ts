import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoEnabled } from '../apps/web/lib/demo-policy';
import { service } from '../apps/web/lib/local-persistence';
import { GET, POST } from '../apps/web/app/api/scene/route';
import { GET as history } from '../apps/web/app/api/scene/history/route';

afterEach(() => vi.unstubAllEnvs());
function request(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/scene', {
    method: 'POST',
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as ConstructorParameters<typeof NextRequest>[1]);
}

describe('explicit shared-demo policy and bounded requests', () => {
  it('requires explicit enablement in every environment', () => {
    expect(demoEnabled({ ROOMSELL_ENABLE_DEMO: '1' })).toBe(true);
    for (const ROOMSELL_ENABLE_DEMO of [undefined, '', 'true', '0'])
      expect(demoEnabled({ ROOMSELL_ENABLE_DEMO })).toBe(false);
  });
  it('disabled production API and history reject before touching demo state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'roomsell-disabled-demo-'));
    vi.stubEnv('ROOMSELL_DATA_DIR', directory);
    vi.stubEnv('ROOMSELL_ENABLE_DEMO', '');
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(() => service()).toThrow('Demo is disabled.');
      expect((await GET()).status).toBe(404);
      expect((await POST(request('{}'))).status).toBe(404);
      expect((await history()).status).toBe(404);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('keeps enabled malformed JSON, origin and media-type response contracts', async () => {
    vi.stubEnv('ROOMSELL_ENABLE_DEMO', '1');
    for (const [input, status, error] of [
      [request('{broken'), 400, 'Invalid scene operation.'],
      [request('{}', { origin: 'https://foreign.example' }), 403, 'Cross-origin edits are not allowed.'],
      [request('{}', { 'content-type': 'text/plain' }), 415, 'JSON is required.'],
    ] as const) {
      const response = await POST(input);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
  });
  it('counts streamed bytes and cancels an oversized request before reading all chunks', async () => {
    vi.stubEnv('ROOMSELL_ENABLE_DEMO', '1');
    let reads = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++;
          controller.enqueue(new TextEncoder().encode('ø'.repeat(4500)));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const response = await POST(request(stream));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Request is too large.' });
    expect(reads).toBe(2);
    expect(cancelled).toBe(true);
  });
});
