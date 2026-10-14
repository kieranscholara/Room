import { requestSchema } from '@roomsell/scene-core';
import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../../lib/http-api';
import { consumerEditor } from '../../../../../../lib/marketplace-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => (await consumerEditor((await params).projectId)).read());
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const value = requestSchema.parse(await jsonBody(request));
    return (await consumerEditor((await params).projectId, value)).execute(value);
  });
}
