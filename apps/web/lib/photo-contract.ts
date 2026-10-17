import { z } from 'zod';
import type { PhotoCalibration } from '@roomsell/geometry';
import { maskStrokeSchema } from './image-mask-contract';
export const photoPointSchema = z
  .object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) })
  .strict();
export const photoBoundsSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.005).max(1),
    height: z.number().min(0.005).max(1),
  })
  .strict()
  .refine(
    (b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001,
    'Selection exceeds the photograph.',
  );
export const photoRegionSchema = z
  .object({
    id: z.uuid(),
    label: z.string().trim().min(1).max(100),
    bounds: photoBoundsSchema,
    disposition: z.enum(['keep', 'remove']),
    foreground: z.boolean().default(false),
    outline: z.array(photoPointSchema).min(3).max(80).optional(),
    maskStrokes: z.array(maskStrokeSchema).max(60).optional(),
  })
  .strict()
  .refine(
    (r) => r.bounds.x + r.bounds.width <= 1.000001 && r.bounds.y + r.bounds.height <= 1.000001,
    'The selection must stay inside the photograph.',
  );
export const photoCalibrationSchema = z
  .object({
    version: z.literal(1),
    imageWidth: z.number().int().min(100).max(12000),
    imageHeight: z.number().int().min(100).max(12000),
    roomWidth: z.number().min(2).max(30),
    roomDepth: z.number().min(2).max(30),
    floor: z
      .object({
        x: z.number().nonnegative().max(30),
        z: z.number().nonnegative().max(30),
        width: z.number().min(0.2).max(30),
        depth: z.number().min(0.2).max(30),
      })
      .strict(),
    points: z.tuple([photoPointSchema, photoPointSchema, photoPointSchema, photoPointSchema]),
  })
  .strict();
export const photoStateSchema = z
  .object({
    calibration: photoCalibrationSchema.nullable(),
    regions: z.array(photoRegionSchema).max(30),
    backgroundReferenceId: z.uuid().nullable(),
  })
  .strict();
export const photoWriteSchema = photoStateSchema
  .extend({ expectedRevision: z.number().int().nonnegative() })
  .refine(
    (v) => new Set(v.regions.map((r) => r.id)).size === v.regions.length,
    'Selections must have unique IDs.',
  );
export type PhotoRegion = z.infer<typeof photoRegionSchema>;
export interface PhotoWorkspace {
  referenceId: string;
  projectId: string;
  revision: number;
  calibration: PhotoCalibration | null;
  regions: PhotoRegion[];
  backgroundReferenceId: string | null;
}
export const photoJobSchema = z
  .object({
    kind: z.enum(['photo_analysis', 'photo_cleanup']),
    provider: z.enum(['openai', 'test']),
    referenceId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    consent: z.literal(true),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const photoAnalysisSchema = z
  .object({
    summary: z.string().min(1).max(1000),
    objects: z
      .array(
        z
          .object({
            label: z.string().min(1).max(100),
            bounds: photoBoundsSchema,
            outline: z.array(photoPointSchema).min(3).max(80).optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
