import { NextResponse } from 'next/server';
import { adminClient } from '../../../lib/supabase-server';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const result = await adminClient().from('organisations').select('id', { head: true }).limit(1);
    if (result.error) throw new Error('database');
    return NextResponse.json(
      { status: 'ok', version: '0.2.0' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
