import { NextRequest } from 'next/server';
import { api, assertSameOrigin } from '../../../../../../../../lib/http-api';
import { uuid } from '../../../../../../../../lib/account-schemas';
import { downloadCatalogueAsset, removeCatalogueAsset } from '../../../../../../../../lib/catalogue-service';
type Context = { params: Promise<{ orgId: string; productId: string; assetId: string }> };
async function identifiers(context: Context) {
  const params = await context.params;
  return {
    orgId: uuid.parse(params.orgId),
    productId: uuid.parse(params.productId),
    assetId: uuid.parse(params.assetId),
  };
}
export async function GET(_request: NextRequest, context: Context) {
  let download: Response | undefined;
  const error = await api(async () => {
    const { orgId, productId, assetId } = await identifiers(context);
    download = await downloadCatalogueAsset(orgId, productId, assetId);
    return null;
  });
  return download || error;
}
export async function DELETE(request: NextRequest, context: Context) {
  return api(async () => {
    assertSameOrigin(request);
    const { orgId, productId, assetId } = await identifiers(context);
    return removeCatalogueAsset(orgId, productId, assetId);
  });
}
