import { NextRequest, NextResponse } from 'next/server';
import { api } from '../../../../../../lib/http-api';
import { uuid } from '../../../../../../lib/account-schemas';
import { catalogueImports, importCatalogue } from '../../../../../../lib/catalogue-service';
type Context = { params: Promise<{ orgId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => catalogueImports(uuid.parse((await params).orgId)));
}
export async function POST(request: NextRequest, { params }: Context) {
  const response = await api(async () => importCatalogue(uuid.parse((await params).orgId), request));
  if (!response.ok) return response;
  const result = await response.json();
  return NextResponse.json(result, {
    status: result.status === 'failed' ? 422 : 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
