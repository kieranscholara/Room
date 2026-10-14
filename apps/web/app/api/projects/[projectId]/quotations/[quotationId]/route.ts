import { NextRequest } from 'next/server';
import { api } from '../../../../../../lib/http-api';
import { getQuotation } from '../../../../../../lib/quotation-service';
type Context = { params: Promise<{ projectId: string; quotationId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const { projectId, quotationId } = await params;
    return getQuotation(projectId, quotationId);
  });
}
