import { z } from 'zod';
import { imageMaskSchema } from './image-mask-contract';
export { maskStrokeSchema, imageMaskSchema, type ImageMask } from './image-mask-contract';
export const photoLayerSchema = z
  .object({
    objectId: z.string().min(1).max(100),
    assetId: z.uuid(),
    mask: imageMaskSchema,
  })
  .strict();
export type PhotoImageLayer = z.infer<typeof photoLayerSchema>;
export const compositionWriteSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    expectedSceneVersion: z.number().int().nonnegative(),
    expectedPhotoRevision: z.number().int().positive(),
    layers: z.array(photoLayerSchema).max(30),
  })
  .strict();
export const photoProofSchema = z
  .object({
    referenceId: z.uuid(),
    compositionRevision: z.number().int().positive(),
    imageSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type PhotoProof = z.infer<typeof photoProofSchema>;
export const photoSnapshotSchema = photoProofSchema
  .extend({
    photoRevision: z.number().int().positive(),
    sceneVersion: z.number().int().nonnegative(),
    renderedReferenceId: z.uuid(),
    confirmedBy: z.uuid(),
    confirmedAt: z.string(),
    layers: z.array(photoLayerSchema).max(30),
  })
  .strict();
export type PhotoSnapshot = z.infer<typeof photoSnapshotSchema>;
export interface PhotoComposition {
  referenceId: string;
  revision: number;
  sceneVersion: number;
  photoRevision: number;
  layers: PhotoImageLayer[];
  renderJobId: string | null;
  renderedReferenceId: string | null;
  imageSha256: string | null;
  confirmed: boolean;
}
export const renderPhotoSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    expectedSceneVersion: z.number().int().nonnegative(),
    expectedPhotoRevision: z.number().int().positive(),
    provider: z.enum(['local', 'openai']),
    consent: z.boolean(),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .refine((v) => v.provider !== 'openai' || v.consent, 'Consent is required for AI lighting.');
