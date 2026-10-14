import { NextRequest } from 'next/server';
import { uuid } from '../../../../../lib/account-schemas';
import { api, jsonBody } from '../../../../../lib/http-api';
import { inventoryOverview, writeInventoryConnection } from '../../../../../lib/inventory-service';
export const runtime = 'nodejs';
type Context = { params: Promise<{ orgId: string }> };
export async function GET(_request: NextRequest, context: Context) {
  return api(async () => inventoryOverview(uuid.parse((await context.params).orgId)));
}
export async function POST(request: NextRequest, context: Context) {
  return api(
    async () =>
      writeInventoryConnection(
        uuid.parse((await context.params).orgId),
        null,
        await jsonBody(request, 16 * 1024),
      ),
    201,
  );
}
