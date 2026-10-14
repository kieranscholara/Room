import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ServiceError, isServiceError } from './editor-service';

export function assertSameOrigin(request: NextRequest, message = 'Cross-origin changes are not allowed.') {
  const origin = request.headers.get('origin');
  if (origin) {
    let permitted = false;
    try {
      const url = new URL(origin);
      permitted = ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.get('host');
    } catch {
      /* Reject malformed origins. */
    }
    if (!permitted) throw new ServiceError(403, message);
  }
}
export async function jsonBody(
  request: NextRequest,
  limit = 64 * 1024,
  messages?: { crossOrigin?: string; invalidJson?: string },
): Promise<unknown> {
  assertSameOrigin(request, messages?.crossOrigin);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new ServiceError(415, 'JSON is required.');
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError(400, 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ServiceError(413, 'Request is too large.');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ServiceError(400, messages?.invalidJson || 'Invalid JSON.');
    throw error;
  }
}
export async function api<T>(task: () => Promise<T>, status = 200) {
  try {
    const result = await task();
    return result instanceof Response
      ? result
      : NextResponse.json(result, { status, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (isServiceError(error))
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: 'Please check the submitted fields.', details: error.issues },
        { status: 400 },
      );
    return NextResponse.json({ error: 'Unable to complete this request.' }, { status: 500 });
  }
}
