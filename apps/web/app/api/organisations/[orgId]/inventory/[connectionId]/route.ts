import { NextRequest } from 'next/server';
import { uuid } from '../../../../../../lib/account-schemas';
import { api, jsonBody } from '../../../../../../lib/http-api';
import { writeInventoryConnection } from '../../../../../../lib/inventory-service';
export const runtime = 'nodejs';
type Context = { params: Promise<{ orgId: string; connectionId: string }> };
export async function PATCH(request: NextRequest, context: Context) {
  return api(async () => {
    const params = await context.params;
    return writeInventoryConnection(
      uuid.parse(params.orgId),
      uuid.parse(params.connectionId),
      await jsonBody(request, 16 * 1024),
    );
  });
}
