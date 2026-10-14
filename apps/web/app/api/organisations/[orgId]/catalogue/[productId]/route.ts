import { NextRequest } from 'next/server';
import { api, assertSameOrigin, jsonBody } from '../../../../../../lib/http-api';
import { uuid } from '../../../../../../lib/account-schemas';
import {
  archiveCatalogueProduct,
  getCatalogueProduct,
  writeCatalogueProduct,
} from '../../../../../../lib/catalogue-service';
type Context = { params: Promise<{ orgId: string; productId: string }> };
async function identifiers(context: Context) {
  const params = await context.params;
  return { orgId: uuid.parse(params.orgId), productId: uuid.parse(params.productId) };
}
export async function GET(_request: NextRequest, context: Context) {
  return api(async () => {
    const { orgId, productId } = await identifiers(context);
    return getCatalogueProduct(orgId, productId);
  });
}
export async function PATCH(request: NextRequest, context: Context) {
  return api(async () => {
    const { orgId, productId } = await identifiers(context);
    return writeCatalogueProduct(orgId, await jsonBody(request), productId);
  });
}
export async function DELETE(request: NextRequest, context: Context) {
  return api(async () => {
    assertSameOrigin(request);
    const { orgId, productId } = await identifiers(context);
    return archiveCatalogueProduct(orgId, productId);
  });
}
