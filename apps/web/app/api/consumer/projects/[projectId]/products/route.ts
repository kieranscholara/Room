import type { NextRequest } from 'next/server';
import { api } from '../../../../../../lib/http-api';
import { consumerSelectedProducts } from '../../../../../../lib/marketplace-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    return consumerSelectedProducts((await params).projectId);
  });
}
