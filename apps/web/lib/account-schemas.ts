import { z } from 'zod';
import { roles } from './supabase-server';
export const uuid = z.uuid();
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const credentialsSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((e) => e.toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .strict();
export const signupSchema = credentialsSchema
  .extend({ displayName: z.string().trim().min(1).max(100) })
  .strict();
export const organisationSchema = z.object({ name: z.string().trim().min(2).max(100), currency }).strict();
export const roleChangeSchema = z.object({ userId: uuid, role: z.enum(roles) }).strict();
export const invitationSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((e) => e.toLowerCase()),
    role: z.enum(['admin', 'salesperson', 'designer', 'customer']),
  })
  .strict();
export const invitationTokenSchema = z
  .object({
    token: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
