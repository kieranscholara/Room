import { z } from 'zod';
import { roomSchema } from '@roomsell/scene-core';
export const customerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.union([z.email().max(254), z.literal(''), z.null()]).optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    notes: z.string().max(5000).default(''),
  })
  .strict();
export const projectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    customerId: z.uuid().nullable().default(null),
    budgetMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
    style: z.string().trim().max(100).default(''),
    roomType: z.enum(['bedroom', 'living_room', 'office', 'other']).default('bedroom'),
    room: roomSchema.refine((r) => r.measurementsConfirmed, { message: 'Confirm the room measurements.' }),
  })
  .strict();
export const projectAccessSchema = z.object({ userId: z.uuid(), canEdit: z.boolean() }).strict();
