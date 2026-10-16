import { z } from 'zod';

export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
export const MAX_INVENTORY_ITEMS = 1000;
export const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
export const inventoryAvailabilitySchema = z.enum(['in_stock', 'made_to_order', 'out_of_stock']);
const externalId = z.string().trim().min(1).max(200);
export const inventoryItemSchema = z
  .object({
    externalProductId: externalId,
    externalVariantId: externalId,
    sku: z.string().trim().min(1).max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
    priceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    stockQuantity: z.number().int().min(0).max(2_147_483_647),
    availability: inventoryAvailabilitySchema,
  })
  .strict()
  .refine((item) => item.availability !== 'in_stock' || item.stockQuantity > 0, {
    message: 'An in-stock item requires positive stock.',
  })
  .refine((item) => item.availability !== 'out_of_stock' || item.stockQuantity === 0, {
    message: 'An out-of-stock item requires zero stock.',
  });
export const inventorySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    items: z.array(inventoryItemSchema).max(MAX_INVENTORY_ITEMS),
  })
  .strict();
export const inventoryMappingSchema = z
  .object({
    externalProductId: externalId,
    externalVariantId: externalId,
    productId: z.uuid(),
    variantId: z.uuid(),
  })
  .strict();
export const inventoryMappingsSchema = z.array(inventoryMappingSchema).max(MAX_INVENTORY_ITEMS);
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type InventorySnapshot = z.infer<typeof inventorySnapshotSchema>;
export type InventoryMapping = z.infer<typeof inventoryMappingSchema>;
export interface InventoryConnection {
  id: string;
  name: string;
  provider: 'custom_rest';
  endpoint: string;
  orderEndpoint?: string | null;
  enabled: boolean;
  revision: number;
  credentialConfigured: boolean;
  lastSyncedAt: string | null;
  lastSourceGeneratedAt: string | null;
}
export class InventoryError extends Error {
  constructor(
    public readonly code:
      | 'invalid_snapshot'
      | 'stale_snapshot'
      | 'mapping_mismatch'
      | 'endpoint_rejected'
      | 'provider_unavailable'
      | 'credentials_unavailable',
  ) {
    super(
      {
        invalid_snapshot: 'The provider returned an invalid or oversized inventory snapshot.',
        stale_snapshot: 'The provider snapshot is stale, replayed or dated in the future.',
        mapping_mismatch: 'Every snapshot item must match one configured variant mapping.',
        endpoint_rejected: 'Use a public HTTPS inventory endpoint without credentials, query or fragment.',
        provider_unavailable: 'The inventory provider could not be reached safely.',
        credentials_unavailable:
          'Inventory credential encryption is not configured or the credential is invalid.',
      }[code],
    );
    this.name = 'InventoryError';
  }
}

export function mappingKey(item: Pick<InventoryItem, 'externalProductId' | 'externalVariantId'>) {
  return JSON.stringify([item.externalProductId, item.externalVariantId]);
}
export function validateMappings(input: unknown): InventoryMapping[] {
  const parsed = inventoryMappingsSchema.safeParse(input);
  if (!parsed.success) throw new InventoryError('mapping_mismatch');
  const externalKeys = parsed.data.map(mappingKey);
  const variantIds = parsed.data.map((item) => item.variantId);
  if (new Set(externalKeys).size !== externalKeys.length || new Set(variantIds).size !== variantIds.length)
    throw new InventoryError('mapping_mismatch');
  return parsed.data;
}
export function parseInventorySnapshot(
  input: unknown,
  options: { now?: number; lastGeneratedAt?: string | null } = {},
): InventorySnapshot {
  const parsed = inventorySnapshotSchema.safeParse(input);
  if (!parsed.success) throw new InventoryError('invalid_snapshot');
  const now = options.now ?? Date.now();
  const generatedAt = Date.parse(parsed.data.generatedAt);
  if (
    generatedAt > now + 60_000 ||
    generatedAt < now - MAX_SNAPSHOT_AGE_MS ||
    (options.lastGeneratedAt && generatedAt <= Date.parse(options.lastGeneratedAt))
  )
    throw new InventoryError('stale_snapshot');
  const keys = parsed.data.items.map(mappingKey);
  if (new Set(keys).size !== keys.length) throw new InventoryError('invalid_snapshot');
  return parsed.data;
}
export function mapSnapshot(snapshot: InventorySnapshot, input: unknown) {
  const mappings = validateMappings(input);
  const byExternal = new Map(mappings.map((item) => [mappingKey(item), item]));
  if (!mappings.length || snapshot.items.length !== mappings.length)
    throw new InventoryError('mapping_mismatch');
  return snapshot.items.map((item) => {
    const mapping = byExternal.get(mappingKey(item));
    if (!mapping) throw new InventoryError('mapping_mismatch');
    return { ...item, productId: mapping.productId, variantId: mapping.variantId };
  });
}
export function inventoryEndpoint(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InventoryError('endpoint_rejected');
  }
  if (
    url.protocol !== 'https:' ||
    (url.port && url.port !== '443') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    input.length > 2048
  )
    throw new InventoryError('endpoint_rejected');
  return url;
}
