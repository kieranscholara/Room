import { z } from 'zod';
import type { Scene, Operation } from '@roomsell/scene-core';
import { priceQuotation, type PricingPolicy, type PricingItem } from '@roomsell/pricing';
export const assistantRequestSchema = z
  .object({
    brief: z.string().trim().min(3).max(2000),
    expectedSceneVersion: z.number().int().nonnegative(),
    provider: z.enum(['openai', 'test']),
    budgetMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    referenceIds: z.array(z.uuid()).max(2).default([]),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const assistantIntentSchema = z
  .object({
    summary: z.string().min(1).max(1000),
    recommendations: z
      .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(6) }).strict())
      .max(6),
    layout: z
      .object({
        objectId: z.string().min(1).max(100),
        x: z.number().finite().min(-100).max(100),
        z: z.number().finite().min(-100).max(100),
        rotation: z
          .number()
          .finite()
          .min(-Math.PI * 2)
          .max(Math.PI * 2),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (new Set(intent.recommendations.map((item) => item.variantId)).size !== intent.recommendations.length)
      context.addIssue({ code: 'custom', message: 'Duplicate recommendation variant.' });
  });
export type AssistantIntent = z.infer<typeof assistantIntentSchema>;
export interface AssistantCandidate {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  variantName: string;
  category: Scene['objects'][number]['category'];
  currency: string;
  priceMinor: number;
  dimensions: Scene['objects'][number]['dimensions'];
  color: string;
  availability: 'in_stock' | 'made_to_order';
  stockQuantity: number;
}
export function validateAssistantIntent(
  input: unknown,
  scene: Scene,
  candidates: AssistantCandidate[],
  policy: PricingPolicy,
  budgetMinor: number,
) {
  const intent = assistantIntentSchema.parse(input),
    byId = new Map(candidates.map((item) => [item.variantId, item]));
  const counts = new Map<string, number>();
  for (const object of scene.objects) counts.set(object.variantId, (counts.get(object.variantId) ?? 0) + 1);
  const added: AssistantCandidate[] = [];
  for (const item of intent.recommendations) {
    const candidate = byId.get(item.variantId);
    if (!candidate) throw new Error('The assistant referenced an unavailable catalogue variant.');
    const quantity = (counts.get(item.variantId) ?? 0) + item.quantity;
    if (candidate.availability === 'in_stock' && quantity > candidate.stockQuantity)
      throw new Error('Recommended quantities exceed available inventory.');
    counts.set(item.variantId, quantity);
    for (let index = 0; index < item.quantity; index++) added.push(candidate);
  }
  if (scene.objects.length + added.length > 30)
    throw new Error('Recommended furniture exceeds the scene limit.');
  const items: PricingItem[] = [];
  for (const [variantId, quantity] of counts) {
    const candidate = byId.get(variantId);
    if (!candidate) throw new Error('A saved item is unavailable or needs catalogue review.');
    if (candidate.availability === 'in_stock' && quantity > candidate.stockQuantity)
      throw new Error('Saved and proposed quantities exceed available inventory.');
    items.push({
      variantId,
      sku: candidate.sku,
      name: candidate.name,
      quantity,
      unitPriceMinor: candidate.priceMinor,
      currency: candidate.currency,
    });
  }
  const calculation = priceQuotation({ policy, items });
  if (added.length && calculation.totals.grandTotalMinor > budgetMinor)
    throw new Error('Recommended furniture exceeds the configured budget including commercial charges.');
  let operation: Operation | null = null;
  if (intent.layout) {
    const object = scene.objects.find((item) => item.id === intent.layout?.objectId);
    if (!object) throw new Error('The assistant referenced an unknown scene object.');
    if (
      object.locks.position &&
      (object.transform.x !== intent.layout.x || object.transform.z !== intent.layout.z)
    )
      throw new Error('The assistant attempted to move a locked object.');
    if (object.locks.rotation && object.transform.rotation !== intent.layout.rotation)
      throw new Error('The assistant attempted to rotate a locked object.');
    operation = {
      type: 'transform',
      objectId: object.id,
      mode: 'smart',
      transform: { x: intent.layout.x, y: 0, z: intent.layout.z, rotation: intent.layout.rotation },
    };
  }
  return {
    intent,
    recommendations: intent.recommendations.map((item) => ({
      ...byId.get(item.variantId)!,
      quantity: item.quantity,
    })),
    calculation,
    overBudget: calculation.totals.grandTotalMinor > budgetMinor,
    operation,
  };
}
export function testAssistantIntent(
  scene: Scene,
  candidates: AssistantCandidate[],
  policy: PricingPolicy,
  budgetMinor: number,
): AssistantIntent {
  const ordered = [...candidates].sort(
    (a, b) => a.priceMinor - b.priceMinor || a.variantId.localeCompare(b.variantId),
  );
  const recommendations: AssistantIntent['recommendations'] = [];
  for (const category of ['bed', 'wardrobe', 'bedside', 'rug', 'desk'] as const) {
    const existing = scene.objects.filter((object) => object.category === category).length;
    if (existing >= (category === 'bedside' ? 2 : 1)) continue;
    for (const candidate of ordered.filter((item) => item.category === category)) {
      const next = {
        summary: 'Explicit local test adapter; these are catalogue-based test recommendations.',
        recommendations: [
          ...recommendations,
          { variantId: candidate.variantId, quantity: category === 'bedside' ? 2 : 1 },
        ],
        layout: null,
      };
      try {
        validateAssistantIntent(next, scene, candidates, policy, budgetMinor);
        recommendations.push(next.recommendations.at(-1)!);
        break;
      } catch {
        /* Try the next genuine catalogue candidate. */
      }
    }
  }
  const movable = scene.objects.find(
    (object) => !object.locks.position && !object.locks.rotation && object.category === 'desk',
  );
  return {
    summary:
      'Fictional-customer test assistant. Catalogue identities, stock, budget and geometry are checked by the server. This output was not generated by OpenAI.',
    recommendations,
    layout: movable
      ? {
          objectId: movable.id,
          x: movable.transform.x,
          z: Math.min(scene.room.depth - movable.dimensions.depth / 2, movable.transform.z + 0.25),
          rotation: movable.transform.rotation,
        }
      : null,
  };
}
