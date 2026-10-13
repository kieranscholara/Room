import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { service } from '../../../lib/local-persistence';
import { ServiceError } from '../../../lib/editor-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(await service().read(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'Unable to read the local room. Check the server log and local data file.' },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  // Next.js may construct nextUrl with its bind address behind a proxy.
  // Compare the browser origin to the actual HTTP Host instead.
  if (origin) {
    let sameOrigin = false;
    try {
      const url = new URL(origin);
      sameOrigin = ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.get('host');
    } catch {
      /* malformed origin is rejected */
    }
    if (!sameOrigin)
      return NextResponse.json({ error: 'Cross-origin edits are not allowed.' }, { status: 403 });
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return NextResponse.json({ error: 'JSON is required.' }, { status: 415 });
  try {
    const body = await request.text();
    if (body.length > 16_384) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    return NextResponse.json(await service().execute(JSON.parse(body)));
  } catch (error) {
    if (error instanceof ServiceError)
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError)
      return NextResponse.json(
        { error: 'Invalid scene operation.', details: error instanceof ZodError ? error.issues : undefined },
        { status: 400 },
      );
    return NextResponse.json({ error: 'Unable to save the local room.' }, { status: 500 });
  }
}
