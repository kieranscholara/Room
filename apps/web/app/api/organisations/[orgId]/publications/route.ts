import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../lib/http-api';
import { publications, publishOffer } from '../../../../../lib/marketplace-service';
type Context = { params: Promise<{ orgId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(() => params.then(({ orgId }) => publications(orgId)));
}
export async function PUT(request: NextRequest, { params }: Context) {
  return api(async () => publishOffer((await params).orgId, await jsonBody(request)));
}
