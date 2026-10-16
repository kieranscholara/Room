import 'server-only';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { supabaseConfig } from './supabase-config';
import { adminClient } from './supabase-server';
import { ServiceError } from './editor-service';
import type { InventoryTransport } from '@roomsell/inventory/server';
import { fulfilmentRequestSchema, type FulfilmentTransport } from '@roomsell/inventory/fulfilment';
const persona = z.object({ id: z.uuid(), email: z.email(), password: z.string().min(12) }).strict();
const fixtureSchema = z
  .object({
    version: z.literal(1),
    organisationId: z.uuid(),
    projectId: z.uuid(),
    connectionId: z.uuid(),
    providerTokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    personas: z.object({ retailer: persona, customer: persona, consumer: persona }).strict(),
    products: z.array(z.object({ id: z.uuid(), variantIds: z.array(z.uuid()), sku: z.string() })),
    consumerProjectId: z.uuid().optional(),
  })
  .strict();
export type TestFixture = z.infer<typeof fixtureSchema>;
export const fixtureDirectory = () =>
  resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.ROOMSELL_TEST_FIXTURE_SET === 'browser'
      ? '../../.local/e2e-fixtures'
      : '../../.local/fixtures',
  );
export const FIXTURE_ENDPOINT = 'https://inventory.boreal-living.test/snapshot';
export const FIXTURE_ORDER_ENDPOINT = 'https://inventory.boreal-living.test/fulfilments';
export function testingEnabled() {
  return (
    process.env.ROOMSELL_ENABLE_TEST_CUSTOMER === '1' &&
    process.env.ROOMSELL_LOCAL_SUPABASE === '1' &&
    supabaseConfig().local
  );
}
export async function testFixture(): Promise<TestFixture> {
  if (!testingEnabled()) throw new ServiceError(404, 'Local test customer is disabled.');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(fixtureDirectory(), 'boreal.json'), 'utf8'));
  } catch {
    throw new ServiceError(503, 'Run npm run seed:test-customer to prepare the fictional retailer.');
  }
  const parsed = fixtureSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(503, 'Local test fixture is invalid. Re-run its setup.');
  const row = await adminClient()
    .from('organisations')
    .select('name')
    .eq('id', parsed.data.organisationId)
    .maybeSingle();
  if (row.error || row.data?.name !== 'Boreal Living — Fictional Test Retailer')
    throw new ServiceError(503, 'The configured test retailer could not be verified.');
  return parsed.data;
}
export async function fixtureTransport(
  orgId: string,
  connectionId: string,
  endpoint: string,
): Promise<InventoryTransport | undefined> {
  if (!testingEnabled()) return undefined;
  const fixture = await testFixture();
  if (
    fixture.organisationId !== orgId ||
    fixture.connectionId !== connectionId ||
    endpoint !== FIXTURE_ENDPOINT
  )
    return undefined;
  return async (_endpoint, token) => {
    const actual = Buffer.from(createHash('sha256').update(token).digest('hex')),
      expected = Buffer.from(fixture.providerTokenHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new ServiceError(503, 'Fictional inventory credential mismatch.');
    const state = await withStockLock(() => reconcileFixtureStock(fixture));
    return Buffer.from(
      JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), items: state.items }),
    );
  };
}
let stockLock: Promise<unknown> = Promise.resolve();
export async function fixtureFulfilmentTransport(
  orgId: string,
  connectionId: string,
  endpoint: string,
): Promise<FulfilmentTransport | undefined> {
  if (!testingEnabled()) return undefined;
  const fixture = await testFixture();
  if (
    fixture.organisationId !== orgId ||
    fixture.connectionId !== connectionId ||
    endpoint !== FIXTURE_ORDER_ENDPOINT
  )
    return undefined;
  return async (_endpoint, token, bytes) => {
    const actual = Buffer.from(createHash('sha256').update(token).digest('hex'));
    const expected = Buffer.from(fixture.providerTokenHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error('Fictional supplier credential mismatch.');
    const request = fulfilmentRequestSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
    return withStockLock(async () => {
      const path = resolve(fixtureDirectory(), 'boreal-supplier-orders.json');
      let ledger: Record<string, { requestHash: string; receipt: unknown }> = {};
      try {
        const source = await readFile(path);
        if (source.length > 8 * 1024 * 1024) throw new Error('Fictional supplier ledger is full.');
        ledger = JSON.parse(source.toString());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const previous = ledger[request.orderId];
      if (previous && previous.requestHash !== request.requestHash)
        throw new Error('Supplier order key cannot be reused for different items.');
      const stock = await reconcileFixtureStock(fixture);
      const available = request.items.every((item) => {
        const supplied = stock.items.find(
          (row: { externalProductId: string; externalVariantId: string }) =>
            row.externalProductId === item.externalProductId &&
            row.externalVariantId === item.externalVariantId,
        );
        return (
          supplied &&
          supplied.sku === item.sku &&
          supplied.availability !== 'out_of_stock' &&
          (supplied.availability === 'made_to_order' || supplied.stockQuantity >= item.quantity)
        );
      });
      const receipt = previous?.receipt ?? {
        schemaVersion: 1,
        orderId: request.orderId,
        requestHash: request.requestHash,
        status: available ? 'accepted' : 'rejected',
        supplierReference: 'BOREAL-' + request.orderId,
      };
      ledger[request.orderId] = { requestHash: request.requestHash, receipt };
      const temporary = path + '.' + randomUUID();
      await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600 });
      await rename(temporary, path);
      return Buffer.from(JSON.stringify(receipt));
    });
  };
}
function withStockLock<T>(work: () => Promise<T>): Promise<T> {
  const next = stockLock.then(work, work);
  stockLock = next.catch(() => undefined);
  return next;
}
async function reconcileFixtureStock(fixture: TestFixture) {
  const path = resolve(fixtureDirectory(), 'boreal-stock.json');
  const bytes = await readFile(path);
  if (bytes.length > 1024 * 1024) throw new ServiceError(422, 'Fictional inventory snapshot is too large.');
  const state = JSON.parse(bytes.toString());
  const result = await adminClient()
    .from('order_items')
    .select('variant_id,quantity,order:retailer_orders!inner(status)')
    .eq('organisation_id', fixture.organisationId)
    .eq('order.status', 'fulfilled')
    .limit(10000);
  if (result.error || (result.data?.length ?? 0) >= 10000)
    throw new ServiceError(503, 'Fictional fulfilment reconciliation unavailable.');
  const totals: Record<string, number> = {};
  for (const row of result.data ?? []) totals[row.variant_id] = (totals[row.variant_id] ?? 0) + row.quantity;
  for (const product of fixture.products)
    for (const variantId of product.variantIds) {
      const applied = state.fulfilledTotals?.[variantId] ?? 0,
        delta = (totals[variantId] ?? 0) - applied;
      if (delta < 0) throw new ServiceError(409, 'Fictional fulfilment history changed; review test stock.');
      if (!delta) continue;
      const item = state.items.find(
        (row: { externalVariantId: string }) => row.externalVariantId === product.sku,
      );
      if (!item) throw new ServiceError(409, 'Fictional variant mapping changed.');
      if (item.availability === 'in_stock') {
        item.stockQuantity = Math.max(0, item.stockQuantity - delta);
        if (!item.stockQuantity) item.availability = 'out_of_stock';
      }
    }
  state.fulfilledTotals = totals;
  const temporary = path + '.' + randomUUID();
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, path);
  return state;
}
export async function updateFixtureStock(input: unknown, actorId: string) {
  const fixture = await testFixture();
  if (actorId !== fixture.personas.retailer.id)
    throw new ServiceError(403, 'Only the fictional showroom manager can adjust test stock.');
  const request = z
    .object({
      externalVariantId: z.string().min(1).max(200),
      stockQuantity: z.number().int().min(0).max(2147483647),
      availability: z.enum(['in_stock', 'made_to_order', 'out_of_stock']),
    })
    .strict()
    .parse(input);
  if (
    (request.availability === 'in_stock' && request.stockQuantity === 0) ||
    (request.availability === 'out_of_stock' && request.stockQuantity !== 0)
  )
    throw new ServiceError(400, 'Availability must agree with quantity.');
  return withStockLock(async () => {
    const path = resolve(fixtureDirectory(), 'boreal-stock.json');
    const state = await reconcileFixtureStock(fixture);
    const item = state.items.find(
      (row: { externalVariantId: string }) => row.externalVariantId === request.externalVariantId,
    );
    if (!item) throw new ServiceError(404, 'Test variant not found.');
    Object.assign(item, request);
    const temporary = path + '.' + randomUUID();
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, path);
    return { updated: true };
  });
}
