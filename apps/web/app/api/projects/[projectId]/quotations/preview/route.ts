import { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../../lib/http-api';
import { previewQuotation } from '../../../../../../lib/quotation-service';
type Context = { params: Promise<{ projectId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => previewQuotation((await params).projectId, await jsonBody(request)));
}
