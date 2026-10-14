import type { NextRequest } from 'next/server';
import { api } from '../../../../../lib/http-api';
import { listRoomReferences, uploadRoomReference } from '../../../../../lib/room-reference-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(() => params.then(({ projectId }) => listRoomReferences(projectId)));
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(() => params.then(({ projectId }) => uploadRoomReference(projectId, request)), 201);
}
