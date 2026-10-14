import { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../lib/http-api';
import { issueQuotation, listQuotations } from '../../../../../lib/quotation-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => listQuotations((await params).projectId));
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => issueQuotation((await params).projectId, await jsonBody(request)), 201);
}
