import type { NextRequest } from 'next/server';
import { api, assertSameOrigin } from '../../../../../../lib/http-api';
import { downloadRoomReference, deleteRoomReference } from '../../../../../../lib/room-reference-service';
type Context = { params: Promise<{ projectId: string; referenceId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(() =>
    params.then(({ projectId, referenceId }) => downloadRoomReference(projectId, referenceId)),
  );
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return api(async () => {
    assertSameOrigin(request);
    const { projectId, referenceId } = await params;
    return deleteRoomReference(projectId, referenceId);
  });
}
