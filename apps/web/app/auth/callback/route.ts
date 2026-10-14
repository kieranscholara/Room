import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '../../../lib/supabase-server';
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const redirect = (location: string) =>
    new NextResponse(null, { status: 303, headers: { Location: location } });
  if (!code || code.length > 2048) return redirect('/auth/login?confirmation=invalid');
  try {
    const client = await serverClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    return redirect(error ? '/auth/login?confirmation=invalid' : '/workspace');
  } catch {
    return redirect('/auth/login?confirmation=invalid');
  }
}
