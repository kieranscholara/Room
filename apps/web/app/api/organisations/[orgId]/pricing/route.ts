import { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../lib/http-api';
import { getRetailerPricing, setRetailerPricing } from '../../../../../lib/quotation-service';
type Context = { params: Promise<{ orgId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => getRetailerPricing((await params).orgId));
}
export async function PUT(request: NextRequest, { params }: Context) {
  return api(async () => setRetailerPricing((await params).orgId, await jsonBody(request)));
}
