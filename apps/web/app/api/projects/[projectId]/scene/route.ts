import { NextRequest } from 'next/server';
import { requestSchema } from '@roomsell/scene-core';
import { api, jsonBody } from '../../../../../lib/http-api';
import {
  projectContext,
  projectEditor,
  validateCatalogueOperation,
} from '../../../../../lib/project-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const context = await projectContext((await params).projectId);
    return (await projectEditor(context)).read();
  });
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const operation = requestSchema.parse(await jsonBody(request));
    const context = await projectContext((await params).projectId, true);
    if (operation.action === 'preview') await validateCatalogueOperation(context, operation.operation);
    return (await projectEditor(context, operation)).execute(operation);
  });
}
