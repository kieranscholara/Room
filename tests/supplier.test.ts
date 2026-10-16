import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  fulfilmentRequestSchema,
  requestSupplierFulfilment,
  validateOrderEndpoint,
} from '@roomsell/inventory/fulfilment';

const endpoint = 'https://inventory.boreal-living.test/fulfilments';
function command() {
  return {
    schemaVersion: 1,
    orderId: randomUUID(),
    requestHash: 'a'.repeat(64),
    currency: 'EUR',
    items: [
      {
        externalProductId: 'BOREAL-BED',
        externalVariantId: 'BOREAL-BED-OAK',
        sku: 'BOREAL-BED-OAK',
        quantity: 2,
      },
    ],
  };
}
function receipt(input: ReturnType<typeof command>) {
  return {
    schemaVersion: 1,
    orderId: input.orderId,
    requestHash: input.requestHash,
    status: 'accepted',
    supplierReference: 'BOREAL-123',
  };
}
describe('supplier acknowledgement contract', () => {
  it('sends only the frozen order identifiers and validates the matching acknowledgement', async () => {
    const input = command();
    const result = await requestSupplierFulfilment(
      endpoint,
      'test-token',
      input,
      async (url, token, body) => {
        expect(url).toBe(endpoint);
        expect(token).toBe('test-token');
        expect(JSON.parse(Buffer.from(body).toString())).toEqual(input);
        return Buffer.from(JSON.stringify(receipt(input)));
      },
    );
    expect(result).toEqual(receipt(input));
  });
  it.each(['order', 'hash', 'status', 'extra', 'empty', 'oversized', 'invalid_utf8'])(
    'rejects %s responses without accepting supplier success',
    async (mode) => {
      const input = command(),
        result = { ...receipt(input) } as Record<string, unknown>;
      if (mode === 'order') result.orderId = randomUUID();
      if (mode === 'hash') result.requestHash = 'b'.repeat(64);
      if (mode === 'status') result.status = 'pending';
      if (mode === 'extra') result.privateToken = 'must-not-be-persisted';
      const bytes =
        mode === 'empty'
          ? Buffer.from('{}')
          : mode === 'oversized'
            ? Buffer.alloc(16385)
            : mode === 'invalid_utf8'
              ? Buffer.from([255])
              : Buffer.from(JSON.stringify(result));
      await expect(
        requestSupplierFulfilment(endpoint, 'test-token', input, async () => bytes),
      ).rejects.toThrow();
    },
  );
  it('rejects invalid quantities and private/cross-origin supplier endpoints', () => {
    const input = command();
    input.items[0].quantity = 0;
    expect(fulfilmentRequestSchema.safeParse(input).success).toBe(false);
    expect(validateOrderEndpoint('https://inventory.boreal-living.test/snapshot', endpoint)).toBe(endpoint);
    for (const url of [
      'http://inventory.boreal-living.test/fulfilments',
      'https://elsewhere.test/fulfilments',
      'https://inventory.boreal-living.test/fulfilments?token=x',
    ])
      expect(() => validateOrderEndpoint('https://inventory.boreal-living.test/snapshot', url)).toThrow();
  });
  it('propagates a timeout so the durable caller can retry the same order', async () => {
    await expect(
      requestSupplierFulfilment(endpoint, 'test-token', command(), async () => {
        throw new Error('timeout');
      }),
    ).rejects.toThrow('timeout');
  });
  it('recognizes an explicit supplier rejection as a terminal outcome', async () => {
    const input = command();
    const rejected = { ...receipt(input), status: 'rejected' };
    expect(
      await requestSupplierFulfilment(endpoint, 'test-token', input, async () =>
        Buffer.from(JSON.stringify(rejected)),
      ),
    ).toEqual(rejected);
  });
});
