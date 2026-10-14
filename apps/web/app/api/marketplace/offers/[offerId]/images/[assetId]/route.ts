import type { NextRequest } from 'next/server';
import { api } from '../../../../../../../lib/http-api';
import { publicOfferImage } from '../../../../../../../lib/marketplace-service';
type Context = { params: Promise<{ offerId: string; assetId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const { offerId, assetId } = await params;
    return publicOfferImage(offerId, assetId);
  });
}
