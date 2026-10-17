import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../../../lib/http-api';
import {
  readComposition,
  changeComposition,
  queueCompositionRender,
} from '../../../../../../../lib/photo-composition-service';
type Context = { params: Promise<{ projectId: string; referenceId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const p = await params;
    return readComposition(p.projectId, p.referenceId);
  });
}
export async function PUT(request: NextRequest, { params }: Context) {
  return api(async () => {
    const p = await params;
    return changeComposition(p.projectId, p.referenceId, await jsonBody(request));
  });
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const p = await params;
    return queueCompositionRender(p.projectId, p.referenceId, await jsonBody(request));
  }, 202);
}
