import { NextResponse } from 'next/server';
import { service } from '../../../../lib/local-persistence';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(await service().revisions(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to read scene revisions.' }, { status: 500 });
  }
}
