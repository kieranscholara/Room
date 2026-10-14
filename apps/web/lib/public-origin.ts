import 'server-only';
import type { NextRequest } from 'next/server';
import { supabaseConfig } from './supabase-config';
import { ServiceError } from './editor-service';
export function applicationOrigin(request: NextRequest) {
  if (supabaseConfig().local) return request.nextUrl.origin;
  const configured = process.env.ROOMSELL_PUBLIC_ORIGIN;
  if (!configured)
    throw new ServiceError(
      503,
      'Configure the public HTTPS application origin before hosted authentication.',
    );
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ServiceError(503, 'Public application origin is invalid.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new ServiceError(503, 'A plain public HTTPS origin is required.');
  return url.origin;
}
