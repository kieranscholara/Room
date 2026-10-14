import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../../lib/http-api';
import { transitionProjectOrder } from '../../../../../../lib/order-service';
type Context = { params: Promise<{ projectId: string; orderId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { projectId, orderId } = await params;
    return transitionProjectOrder(projectId, orderId, await jsonBody(request));
  });
}
