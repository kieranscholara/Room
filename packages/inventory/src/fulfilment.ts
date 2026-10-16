import { z } from 'zod';
import { inventoryEndpoint, InventoryError } from './index';

export const fulfilmentRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: z.uuid(),
    requestHash: z.string().regex(/^[0-9a-f]{64}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    items: z
      .array(
        z
          .object({
            externalProductId: z.string().min(1).max(200),
            externalVariantId: z.string().min(1).max(200),
            sku: z.string().min(1).max(100),
            quantity: z.number().int().min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export const fulfilmentReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: z.uuid(),
    requestHash: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(['accepted', 'rejected']),
    supplierReference: z.string().trim().min(1).max(200),
  })
  .strict();
export type FulfilmentRequest = z.infer<typeof fulfilmentRequestSchema>;
export type FulfilmentReceipt = z.infer<typeof fulfilmentReceiptSchema>;
export type FulfilmentTransport = (endpoint: string, token: string, body: Uint8Array) => Promise<Uint8Array>;

export function validateOrderEndpoint(snapshotEndpoint: string, endpoint: string) {
  const url = inventoryEndpoint(endpoint);
  if (url.origin !== inventoryEndpoint(snapshotEndpoint).origin)
    throw new InventoryError('endpoint_rejected');
  return url.toString();
}
export async function requestSupplierFulfilment(
  endpoint: string,
  token: string,
  input: unknown,
  transport: FulfilmentTransport,
): Promise<FulfilmentReceipt> {
  inventoryEndpoint(endpoint);
  const request = fulfilmentRequestSchema.parse(input);
  const bytes = await transport(endpoint, token, Buffer.from(JSON.stringify(request)));
  if (bytes.byteLength > 16 * 1024) throw new Error('Invalid supplier acknowledgement.');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Invalid supplier acknowledgement.');
  }
  const result = fulfilmentReceiptSchema.safeParse(raw);
  if (
    !result.success ||
    result.data.orderId !== request.orderId ||
    result.data.requestHash !== request.requestHash
  )
    throw new Error('Supplier acknowledgement does not match this order.');
  return result.data;
}
