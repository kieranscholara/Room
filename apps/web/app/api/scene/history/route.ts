import { NextResponse } from 'next/server';
import { service } from '../../../../lib/local-persistence';
import { isServiceError } from '../../../../lib/editor-service';
import { assertDemoEnabled } from '../../../../lib/demo-policy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    assertDemoEnabled();
    return NextResponse.json(await service().revisions(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (isServiceError(error))
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    return NextResponse.json({ error: 'Unable to read scene revisions.' }, { status: 500 });
  }
}
