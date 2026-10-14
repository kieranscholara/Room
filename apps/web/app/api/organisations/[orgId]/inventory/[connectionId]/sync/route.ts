import { NextRequest } from 'next/server';
import { uuid } from '../../../../../../../lib/account-schemas';
import { api, jsonBody } from '../../../../../../../lib/http-api';
import { syncInventoryConnection } from '../../../../../../../lib/inventory-service';
export const runtime = 'nodejs';
type Context = { params: Promise<{ orgId: string; connectionId: string }> };
export async function POST(request: NextRequest, context: Context) {
  return api(async () => {
    const params = await context.params;
    return syncInventoryConnection(
      uuid.parse(params.orgId),
      uuid.parse(params.connectionId),
      await jsonBody(request, 1024),
    );
  });
}
