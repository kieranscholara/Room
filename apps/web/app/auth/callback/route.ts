import type { NextRequest } from 'next/server';
import { completeAuthCallback } from '../../../lib/auth-callback';
export async function GET(request: NextRequest) {
  return completeAuthCallback(request, request.nextUrl.searchParams.get('next') === '/auth/reset-password');
}
