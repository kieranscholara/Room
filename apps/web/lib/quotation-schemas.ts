import { z } from 'zod';
import { pricingPolicySchema, quotationPricingSchema, pricingItemSchema } from '@roomsell/pricing';
import { photoProofSchema, photoSnapshotSchema } from './photo-image-contract';

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const policyWriteSchema = z
  .object({ expectedRevision: z.number().int().nonnegative(), policy: pricingPolicySchema })
  .strict();
export const quotationPreviewSchema = z
  .object({
    expectedSceneVersion: z.number().int().nonnegative(),
    expectedPolicyRevision: z.number().int().positive(),
    photo: photoProofSchema.optional(),
  })
  .strict();
export const quotationIssueSchema = quotationPreviewSchema
  .extend({ idempotencyKey: z.uuid(), expectedSourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();
export const quotationSourceSchema = z
  .object({
    version: z.literal(1),
    retailer: z
      .object({ id: z.uuid(), name: z.string().min(1).max(100), currency: z.string().regex(/^[A-Z]{3}$/) })
      .strict(),
    project: z
      .object({
        id: z.uuid(),
        name: z.string().min(1).max(100),
        currency: z.string().regex(/^[A-Z]{3}$/),
        budgetMinor: money,
        customerId: z.uuid().nullable(),
      })
      .strict(),
    customer: z
      .object({
        id: z.uuid(),
        name: z.string().min(1).max(100),
        email: z.string().max(254).nullable(),
        phone: z.string().max(50).nullable(),
      })
      .strict()
      .nullable(),
    sceneId: z.uuid(),
    sceneVersion: z.number().int().nonnegative(),
    policyRevision: z.number().int().positive(),
    policy: pricingPolicySchema,
    items: z
      .array(
        pricingItemSchema
          .extend({
            productId: z.uuid(),
            objectIds: z.array(z.string().min(1)).min(1).max(100),
            variantName: z.string().min(1).max(100),
            category: z.enum(['bed', 'wardrobe', 'bedside', 'rug', 'desk']),
            dimensions: z
              .object({
                width: z.number().positive(),
                depth: z.number().positive(),
                height: z.number().positive(),
              })
              .strict(),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            material: z.string().max(100),
            availability: z.enum(['in_stock', 'made_to_order']),
            stockQuantity: z.number().int().nonnegative(),
            leadTimeDays: z.number().int().nonnegative(),
            variantUpdatedAt: z.string().min(1),
            productUpdatedAt: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type QuotationSource = z.infer<typeof quotationSourceSchema>;
export const quotationSnapshotSchema = z
  .object({
    version: z.literal(1),
    source: quotationSourceSchema,
    calculation: quotationPricingSchema,
    inventoryReserved: z.literal(false),
    photo: photoSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const { source, calculation } = snapshot;
    if (
      snapshot.photo &&
      (snapshot.photo.sceneVersion !== source.sceneVersion ||
        JSON.stringify(snapshot.photo.layers.map((l) => l.objectId).sort()) !==
          JSON.stringify(source.items.flatMap((i) => i.objectIds).sort()))
    )
      context.addIssue({
        code: 'custom',
        message: 'Quotation image layers differ from the issued products or design revision',
      });
    if (
      source.project.currency !== source.policy.currency ||
      source.retailer.currency !== source.policy.currency ||
      JSON.stringify(source.policy) !== JSON.stringify(calculation.policy) ||
      source.items.length !== calculation.lines.length
    )
      context.addIssue({ code: 'custom', message: 'Quotation policy or item count differs from its source' });
    for (const item of source.items) {
      const line = calculation.lines.find((candidate) => candidate.variantId === item.variantId);
      if (
        !line ||
        line.sku !== item.sku ||
        line.name !== item.name ||
        line.quantity !== item.quantity ||
        line.unitPriceMinor !== item.unitPriceMinor ||
        line.currency !== item.currency ||
        item.objectIds.length !== item.quantity ||
        (item.availability === 'in_stock' && item.quantity > item.stockQuantity)
      )
        context.addIssue({ code: 'custom', message: 'Quotation item differs from its authoritative source' });
    }
  });
export type QuotationSnapshot = z.infer<typeof quotationSnapshotSchema>;
export interface IssuedQuotation {
  id: string;
  organisationId: string;
  projectId: string;
  sceneId: string;
  sceneVersion: number;
  policyRevision: number;
  number: string;
  issuedAt: string;
  snapshot: QuotationSnapshot;
}
export interface RetailerPricingPolicy {
  revision: number;
  policy: z.infer<typeof pricingPolicySchema>;
  updatedAt: string;
}
