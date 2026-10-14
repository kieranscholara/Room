import type { NextRequest } from 'next/server';
import { api } from '../../../../../lib/http-api';
import { publicOffer } from '../../../../../lib/marketplace-service';
type Context = { params: Promise<{ offerId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    return publicOffer((await params).offerId);
  });
}
