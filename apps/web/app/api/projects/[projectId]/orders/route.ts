import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../lib/http-api';
import { listProjectOrders, reserveProjectOrder } from '../../../../../lib/order-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(() => params.then(({ projectId }) => listProjectOrders(projectId)));
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => reserveProjectOrder((await params).projectId, await jsonBody(request)), 201);
}
