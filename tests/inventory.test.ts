import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InventoryError,
  inventoryEndpoint,
  mapSnapshot,
  MAX_SNAPSHOT_BYTES,
  parseInventorySnapshot,
  validateMappings,
} from '@roomsell/inventory';
import {
  decryptInventoryToken,
  encryptInventoryToken,
  encryptionConfigured,
  fetchInventorySnapshot,
  isPublicInventoryAddress,
  resolveInventoryEndpoint,
  secureInventoryTransport,
} from '@roomsell/inventory/server';

const now = Date.parse('2026-10-14T12:00:00Z');
function item() {
  return {
    externalProductId: 'actual-product',
    externalVariantId: 'actual-variant',
    sku: 'ACTUAL-SKU',
    currency: 'EUR',
    priceMinor: 12345,
    stockQuantity: 4,
    availability: 'in_stock' as const,
  };
}
function snapshot() {
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(), items: [item()] };
}
const mapping = {
  externalProductId: 'actual-product',
  externalVariantId: 'actual-variant',
  productId: randomUUID(),
  variantId: randomUUID(),
};
afterEach(() => vi.useRealTimers());

describe('bounded provider-neutral inventory contract', () => {
  it('matches explicit external identities to real variant IDs without inventing products', () => {
    const mapped = mapSnapshot(parseInventorySnapshot(snapshot(), { now }), [mapping]);
    expect(mapped).toEqual([{ ...item(), productId: mapping.productId, variantId: mapping.variantId }]);
  });
  it.each([
    { ...item(), priceMinor: 1.5 },
    { ...item(), priceMinor: Number.MAX_SAFE_INTEGER + 1 },
    { ...item(), stockQuantity: -1 },
    { ...item(), stockQuantity: 0 },
    { ...item(), stockQuantity: 2_147_483_648 },
    { ...item(), availability: 'out_of_stock' },
    { ...item(), availability: 'invented' },
    { ...item(), currency: 'eur' },
  ])('rejects invalid provider inventory values %#', (invalid) => {
    expect(() => parseInventorySnapshot({ ...snapshot(), items: [invalid] }, { now })).toThrow(
      InventoryError,
    );
  });
  it('rejects unknown fields, duplicate external IDs, and excessive rows', () => {
    expect(() => parseInventorySnapshot({ ...snapshot(), token: 'never echoed' }, { now })).toThrow(
      'invalid',
    );
    expect(() => parseInventorySnapshot({ ...snapshot(), items: [item(), item()] }, { now })).toThrow(
      'invalid',
    );
    expect(() =>
      parseInventorySnapshot(
        {
          ...snapshot(),
          items: Array.from({ length: 1001 }, (_, index) => ({
            ...item(),
            externalVariantId: String(index),
          })),
        },
        { now },
      ),
    ).toThrow('invalid');
  });
  it('rejects stale, replayed and future snapshots', () => {
    for (const generatedAt of [now - 15 * 60_000 - 1, now + 60_001])
      expect(() =>
        parseInventorySnapshot({ ...snapshot(), generatedAt: new Date(generatedAt).toISOString() }, { now }),
      ).toThrow('stale');
    expect(() =>
      parseInventorySnapshot(snapshot(), { now, lastGeneratedAt: snapshot().generatedAt }),
    ).toThrow('stale');
  });
  it('requires a complete mapped snapshot and forbids duplicate local variants', () => {
    const valid = parseInventorySnapshot(snapshot(), { now });
    expect(() => mapSnapshot(valid, [])).toThrow('mapping');
    expect(() => mapSnapshot(valid, [{ ...mapping, externalVariantId: 'unknown' }])).toThrow('mapping');
    expect(() => validateMappings([mapping, { ...mapping, externalVariantId: 'another' }])).toThrow(
      'mapping',
    );
    expect(() => validateMappings([mapping, mapping])).toThrow('mapping');
  });
});

describe('server-only encrypted inventory credentials', () => {
  it('uses randomized authenticated encryption bound to the retailer', () => {
    const key = randomBytes(32).toString('base64');
    const org = randomUUID();
    const token = 'actual-private-provider-token';
    const first = encryptInventoryToken(token, key, org);
    expect(first).not.toContain(token);
    expect(first).not.toEqual(encryptInventoryToken(token, key, org));
    expect(decryptInventoryToken(first, key, org)).toBe(token);
    expect(() => decryptInventoryToken(first, key, randomUUID())).toThrow('credential');
    expect(() => decryptInventoryToken(first, randomBytes(32).toString('base64'), org)).toThrow('credential');
    const parts = first.split('.');
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
    expect(() => decryptInventoryToken(parts.join('.'), key, org)).toThrow('credential');
  });
  it('requires a canonical 32-byte key and safe header token', () => {
    const org = randomUUID();
    for (const key of [undefined, '', 'invalid', randomBytes(16).toString('base64')]) {
      expect(encryptionConfigured(key)).toBe(false);
      expect(() => encryptInventoryToken('token', key, org)).toThrow('credential');
    }
    const key = randomBytes(32).toString('base64');
    expect(encryptionConfigured(key)).toBe(true);
    expect(() => encryptInventoryToken('token\r\nAuthorization: leaked', key, org)).toThrow('credential');
  });
});

describe('inventory SSRF and transport boundaries', () => {
  it.each([
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com:8443',
    'https://example.com?token=secret',
    'https://example.com#fragment',
  ])('rejects unsafe endpoint %s', (endpoint) => {
    expect(() => inventoryEndpoint(endpoint)).toThrow('public HTTPS');
  });
  it.each([
    '127.0.0.1',
    '10.2.3.4',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '203.0.113.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:0000:ffff::1',
    '2001:0002::1',
    '2001:0db8::1',
    '2002:c0a8:0101::1',
    '3fff::1',
  ])('rejects non-public/transition IP %s', (address) => {
    expect(isPublicInventoryAddress(address)).toBe(false);
  });
  it('permits public IPv4 and IPv6 and rejects mixed public/private DNS answers', async () => {
    expect(isPublicInventoryAddress('1.1.1.1')).toBe(true);
    expect(isPublicInventoryAddress('2606:4700:4700::1111')).toBe(true);
    const resolver = vi.fn().mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(resolveInventoryEndpoint('https://provider.example', { lookup: resolver })).rejects.toThrow(
      'public HTTPS',
    );
  });
  it('bounds DNS time before any HTTP connection can begin', async () => {
    vi.useFakeTimers();
    const pending = resolveInventoryEndpoint('https://provider.example', {
      lookup: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      timeoutMs: 30,
    });
    const rejection = expect(pending).rejects.toThrow('could not be reached');
    await vi.advanceTimersByTimeAsync(31);
    await rejection;
  });
  it('never contacts a controlled local HTTP server', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.end('private');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await expect(secureInventoryTransport('https://127.0.0.1', 'secret')).rejects.toThrow('public HTTPS');
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('parses a bounded transport snapshot without returning credentials and rejects oversized/invalid bytes', async () => {
    const transport = vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(snapshot())));
    expect(
      await fetchInventorySnapshot('https://provider.example/inventory', 'private-token', { transport, now }),
    ).toEqual(snapshot());
    transport.mockResolvedValue(new Uint8Array(MAX_SNAPSHOT_BYTES + 1));
    await expect(
      fetchInventorySnapshot('https://provider.example/inventory', 'private-token', { transport, now }),
    ).rejects.toThrow('oversized');
    transport.mockResolvedValue(new Uint8Array([0xff]));
    await expect(
      fetchInventorySnapshot('https://provider.example/inventory', 'private-token', { transport, now }),
    ).rejects.toThrow('invalid');
  });
});
