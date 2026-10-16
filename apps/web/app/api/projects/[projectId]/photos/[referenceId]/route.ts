import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../../lib/http-api';
import { readPhotoWorkspace, writePhotoWorkspace } from '../../../../../../lib/photo-service';
type Context = { params: Promise<{ projectId: string; referenceId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const p = await params;
    return readPhotoWorkspace(p.projectId, p.referenceId);
  });
}
export async function PUT(request: NextRequest, { params }: Context) {
  return api(async () => {
    const p = await params;
    return writePhotoWorkspace(p.projectId, p.referenceId, await jsonBody(request));
  });
}
