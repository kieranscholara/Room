import { z } from 'zod';
import type { Scene, Operation } from '@roomsell/scene-core';
import { priceQuotation, type PricingPolicy, type PricingItem } from '@roomsell/pricing';
import type { PhotoRegion } from './photo-contract';
const photoSourceSchema = z
  .object({ referenceId: z.uuid(), expectedRevision: z.number().int().nonnegative() })
  .strict();
export const assistantRequestSchema = z
  .object({
    brief: z.string().trim().min(3).max(2000),
    expectedSceneVersion: z.number().int().nonnegative(),
    provider: z.enum(['openai', 'test']),
    budgetMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    referenceIds: z.array(z.uuid()).max(2).default([]),
    photoWorkspaces: z.array(photoSourceSchema).max(2).default([]),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.referenceIds).size !== request.referenceIds.length)
      context.addIssue({ code: 'custom', message: 'Photograph references must be unique.' });
    if (
      new Set(request.photoWorkspaces.map((source) => source.referenceId)).size !==
      request.photoWorkspaces.length
    )
      context.addIssue({ code: 'custom', message: 'Photograph workspace references must be unique.' });
    if (request.photoWorkspaces.some((source) => !request.referenceIds.includes(source.referenceId)))
      context.addIssue({
        code: 'custom',
        message: 'Photograph workspace advice requires a selected reference.',
      });
  });
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
    sceneRemovals: z
      .array(
        z
          .object({ objectId: z.string().min(1).max(100), rationale: z.string().trim().min(1).max(500) })
          .strict(),
      )
      .max(6)
      .default([]),
    existingFurniture: z
      .array(
        z
          .object({
            referenceId: z.uuid(),
            regionId: z.uuid(),
            action: z.enum(['keep', 'remove']),
            rationale: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((intent, context) => {
    if (new Set(intent.recommendations.map((item) => item.variantId)).size !== intent.recommendations.length)
      context.addIssue({ code: 'custom', message: 'Duplicate recommendation variant.' });
    if (new Set(intent.sceneRemovals.map((item) => item.objectId)).size !== intent.sceneRemovals.length)
      context.addIssue({ code: 'custom', message: 'Duplicate furniture removal.' });
    if (
      new Set(intent.existingFurniture.map((item) => `${item.referenceId}:${item.regionId}`)).size !==
      intent.existingFurniture.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate photograph furniture advice.' });
  });
export type AssistantIntent = z.infer<typeof assistantIntentSchema>;
export interface AssistantPhotoContext {
  referenceId: string;
  revision: number;
  regions: PhotoRegion[];
  backgroundReferenceId: string | null;
}
export interface AssistantSceneRemoval {
  objectId: string;
  name: string;
  sku: string;
  rationale: string;
  operation: Extract<Operation, { type: 'remove-object' }>;
}
export interface AssistantExistingFurniture {
  referenceId: string;
  regionId: string;
  workspaceRevision: number;
  label: string;
  action: 'keep' | 'remove';
  rationale: string;
}
export function assertAssistantPhotoSources(
  expected: { referenceId: string; expectedRevision: number }[],
  current: AssistantPhotoContext[],
) {
  if (
    expected.length !== current.length ||
    expected.some(
      (source) =>
        !current.some(
          (photo) => photo.referenceId === source.referenceId && photo.revision === source.expectedRevision,
        ),
    )
  )
    throw new Error('Photograph selections changed; request fresh completion advice.');
}
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
  photos: AssistantPhotoContext[] = [],
) {
  const intent = assistantIntentSchema.parse(input),
    byId = new Map(candidates.map((item) => [item.variantId, item]));
  const sceneRemovals: AssistantSceneRemoval[] = intent.sceneRemovals.map((removal) => {
    const object = scene.objects.find((item) => item.id === removal.objectId);
    if (!object) throw new Error('The assistant referenced an unknown furniture removal.');
    if (object.locks.product) throw new Error('The assistant attempted to remove product-locked furniture.');
    if (
      scene.groups.some((group) => group.objectIds.includes(object.id)) ||
      scene.objects.some((item) => item.follows?.anchorId === object.id)
    )
      throw new Error('The assistant attempted to remove grouped or referenced furniture.');
    if (intent.layout?.objectId === object.id)
      throw new Error('The assistant cannot move and remove the same furniture.');
    return {
      ...removal,
      name: object.name,
      sku: object.sku,
      operation: { type: 'remove-object', objectId: object.id },
    };
  });
  const existingFurniture: AssistantExistingFurniture[] = intent.existingFurniture.map((advice) => {
    const photo = photos.find((item) => item.referenceId === advice.referenceId),
      region = photo?.regions.find((item) => item.id === advice.regionId);
    if (!photo || !region) throw new Error('The assistant referenced an unknown photograph selection.');
    return { ...advice, label: region.label, workspaceRevision: photo.revision };
  });
  const removedIds = new Set(sceneRemovals.map((item) => item.objectId));
  const retainedObjects = scene.objects.filter((object) => !removedIds.has(object.id));
  const counts = new Map<string, number>();
  for (const object of retainedObjects) counts.set(object.variantId, (counts.get(object.variantId) ?? 0) + 1);
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
  if (retainedObjects.length + added.length > 30)
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
    sceneRemovals,
    existingFurniture,
    calculationBasis: 'projected_completion' as const,
  };
}
export function testAssistantIntent(
  scene: Scene,
  candidates: AssistantCandidate[],
  policy: PricingPolicy,
  budgetMinor: number,
  photos: AssistantPhotoContext[] = [],
  brief = '',
): AssistantIntent {
  const ordered = [...candidates].sort(
    (a, b) => a.priceMinor - b.priceMinor || a.variantId.localeCompare(b.variantId),
  );
  const explicitReplacement =
    /^\s*(?:please\s+)?(?:remove|replace)\s+(?:the\s+)?(bedside|wardrobe|desk|rug|bed)\b/i.exec(brief);
  const removeOriginalFurniture =
    /^\s*(?:please\s+)?(?:remove|replace)\s+(?:the\s+)?(?:original|existing)\s+(?:furniture|items|objects)\b/i.test(
      brief,
    );
  const removable =
    explicitReplacement &&
    scene.objects.find(
      (object) =>
        object.category === explicitReplacement[1].toLowerCase() &&
        !object.locks.product &&
        !scene.groups.some((group) => group.objectIds.includes(object.id)) &&
        !scene.objects.some((item) => item.follows?.anchorId === object.id),
    );
  const sceneRemovals: AssistantIntent['sceneRemovals'] = removable
    ? [
        {
          objectId: removable.id,
          rationale:
            'Local test advice follows your explicit request to remove or replace this item. Preview and confirm removal before placing its replacement.',
        },
      ]
    : [];
  const recommendations: AssistantIntent['recommendations'] = [];
  for (const category of ['bed', 'wardrobe', 'bedside', 'rug', 'desk'] as const) {
    const existing = scene.objects.filter(
      (object) => object.category === category && object.id !== (removable && removable.id),
    ).length;
    if (existing >= (category === 'bedside' ? 2 : 1)) continue;
    for (const candidate of ordered.filter((item) => item.category === category)) {
      const next = {
        summary: 'Explicit local test adapter; these are catalogue-based test recommendations.',
        recommendations: [
          ...recommendations,
          { variantId: candidate.variantId, quantity: (category === 'bedside' ? 2 : 1) - existing },
        ],
        layout: null,
        sceneRemovals,
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
    (object) =>
      !object.locks.position &&
      !object.locks.rotation &&
      object.category === 'desk' &&
      object.id !== (removable && removable.id),
  );
  return {
    summary:
      'Fictional-customer test assistant. Catalogue identities, stock, budget and geometry are checked by the server. This output was not generated by OpenAI.',
    recommendations,
    sceneRemovals,
    existingFurniture: photos.flatMap((photo) =>
      photo.regions.slice(0, 10).map((region) => ({
        referenceId: photo.referenceId,
        regionId: region.id,
        action: removeOriginalFurniture ? ('remove' as const) : region.disposition,
        rationale: removeOriginalFurniture
          ? 'Local test advice follows your explicit request to remove original furniture, using only reviewed photo selections. Review and apply this selection before requesting image cleanup.'
          : region.disposition === 'remove'
            ? 'Local test advice follows your reviewed removal selection. Confirm it before generating a cleaned photograph.'
            : 'Local test advice keeps this reviewed existing item. Choose removal explicitly if the client wants to replace it.',
      })),
    ),
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
