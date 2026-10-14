import { NextRequest } from 'next/server';
import { api } from '../../../../../../../lib/http-api';
import { uuid } from '../../../../../../../lib/account-schemas';
import { uploadCatalogueAsset } from '../../../../../../../lib/catalogue-service';
type Context = { params: Promise<{ orgId: string; productId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const values = await params;
    return uploadCatalogueAsset(uuid.parse(values.orgId), uuid.parse(values.productId), request);
  }, 201);
}
