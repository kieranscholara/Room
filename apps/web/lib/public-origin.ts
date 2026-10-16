import 'server-only';
import type { NextRequest } from 'next/server';
import { supabaseConfig } from './supabase-config';
import { ServiceError } from './editor-service';
export function applicationOrigin(request: NextRequest) {
  if (supabaseConfig().local) {
    // Next's internal URL can use its 0.0.0.0 bind address. Local email links
    // must instead use the browser's checked loopback host and port.
    try {
      const url = new URL(
        `${request.nextUrl.protocol}//${request.headers.get('host') || request.nextUrl.host}`,
      );
      if (
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      )
        return url.origin;
    } catch {
      /* Reject ambiguous local hosts. */
    }
    throw new ServiceError(503, 'Local authentication requires a loopback application origin.');
  }
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
