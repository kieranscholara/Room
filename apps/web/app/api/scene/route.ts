import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { service } from '../../../lib/local-persistence';
import { isServiceError } from '../../../lib/editor-service';
import { assertDemoEnabled } from '../../../lib/demo-policy';
import { jsonBody } from '../../../lib/http-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    assertDemoEnabled();
    return NextResponse.json(await service().read(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (isServiceError(error))
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    return NextResponse.json(
      { error: 'Unable to read the local room. Check the server log and local data file.' },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    assertDemoEnabled();
    const body = await jsonBody(request, 16_384, {
      crossOrigin: 'Cross-origin edits are not allowed.',
      invalidJson: 'Invalid scene operation.',
    });
    return NextResponse.json(await service().execute(body));
  } catch (error) {
    if (isServiceError(error))
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError)
      return NextResponse.json(
        { error: 'Invalid scene operation.', details: error instanceof ZodError ? error.issues : undefined },
        { status: 400 },
      );
    return NextResponse.json({ error: 'Unable to save the local room.' }, { status: 500 });
  }
}
