import { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../lib/http-api';
import { uuid } from '../../../../../lib/account-schemas';
import { listCatalogue, writeCatalogueProduct } from '../../../../../lib/catalogue-service';
type Context = { params: Promise<{ orgId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  return api(async () =>
    listCatalogue(uuid.parse((await params).orgId), {
      query: request.nextUrl.searchParams.get('q') || undefined,
      category: request.nextUrl.searchParams.get('category') || undefined,
      active: request.nextUrl.searchParams.get('active') || undefined,
      offset: Number(request.nextUrl.searchParams.get('offset') || 0),
    }),
  );
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(
    async () => writeCatalogueProduct(uuid.parse((await params).orgId), await jsonBody(request), null),
    201,
  );
}
