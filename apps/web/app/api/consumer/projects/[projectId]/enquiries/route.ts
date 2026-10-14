import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../../lib/http-api';
import { requestRetailerEnquiry } from '../../../../../../lib/marketplace-service';
type Context = { params: Promise<{ projectId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    return requestRetailerEnquiry((await params).projectId, await jsonBody(request));
  });
}
