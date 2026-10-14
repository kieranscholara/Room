import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { supabaseConfig } from './supabase-config';
import { ServiceError } from './editor-service';

export async function serverClient() {
  const config = supabaseConfig();
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const secure = !config.local || requestHeaders.get('x-forwarded-proto') === 'https';
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values)
          cookieStore.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure, path: '/' });
      },
    },
  });
}
export function adminClient() {
  const config = supabaseConfig();
  return createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authenticated() {
  const client = await serverClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email) throw new ServiceError(401, 'Sign in to continue.');
  return { client, user: data.user };
}
export const roles = ['owner', 'admin', 'salesperson', 'designer', 'customer'] as const;
export type Role = (typeof roles)[number];
export async function membership(organisationId: string, allowed: readonly Role[] = roles) {
  const { client, user } = await authenticated();
  const result = await client
    .from('organisation_members')
    .select('role')
    .eq('organisation_id', organisationId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (result.error || !result.data || !allowed.includes(result.data.role as Role))
    throw new ServiceError(403, 'You do not have permission for this organisation.');
  return { client, user, role: result.data.role as Role };
}
export function databaseError(error: { code?: string; message: string } | null) {
  if (!error) return;
  const status =
    error.code === '40001'
      ? 409
      : error.code === '42501'
        ? 403
        : error.code === '23505'
          ? 409
          : error.code === 'P0002'
            ? 404
            : ['22023', '23514', '23503', '22P02'].includes(error.code || '')
              ? 400
              : 500;
  throw new ServiceError(
    status,
    status === 500 ? 'The database operation could not be completed.' : error.message,
  );
}
