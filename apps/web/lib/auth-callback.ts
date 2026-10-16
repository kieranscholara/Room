import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from './supabase-server';

export async function completeAuthCallback(request: NextRequest, recovery: boolean) {
  const code = request.nextUrl.searchParams.get('code');
  const redirect = (location: string) =>
    new NextResponse(null, { status: 303, headers: { Location: location } });
  if (!code || code.length > 2048) return redirect('/auth/login?confirmation=invalid');
  try {
    const client = await serverClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    return redirect(
      error ? '/auth/login?confirmation=invalid' : recovery ? '/auth/reset-password' : '/workspace',
    );
  } catch {
    return redirect('/auth/login?confirmation=invalid');
  }
}
