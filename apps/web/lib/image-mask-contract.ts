import { z } from 'zod';
export const maskPointSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
export const maskStrokeSchema = z
  .object({
    mode: z.enum(['erase', 'restore']),
    radius: z.number().min(0.002).max(0.15),
    points: z.array(maskPointSchema).min(1).max(100),
  })
  .strict();
export const imageMaskSchema = z
  .object({
    automatic: z.boolean(),
    strokes: z.array(maskStrokeSchema).max(60),
    outline: z.array(maskPointSchema).min(3).max(80).optional(),
  })
  .strict();
export type ImageMask = z.infer<typeof imageMaskSchema>;
