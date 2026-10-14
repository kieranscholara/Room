import { NextRequest } from 'next/server';
import { api, jsonBody, assertSameOrigin } from '../../../../../lib/http-api';
import { membership, databaseError } from '../../../../../lib/supabase-server';
import { roleChangeSchema, uuid } from '../../../../../lib/account-schemas';
type Context = { params: Promise<{ orgId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId);
    const { client } = await membership(orgId, ['owner', 'admin']);
    const result = await client.rpc('list_members', { p_org_id: orgId });
    databaseError(result.error);
    return result.data;
  });
}
export async function PATCH(request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId);
    const body = roleChangeSchema.parse(await jsonBody(request));
    const { client } = await membership(orgId, ['owner', 'admin']);
    const result = await client.rpc('set_member_role', {
      p_org_id: orgId,
      p_user_id: body.userId,
      p_role: body.role,
    });
    databaseError(result.error);
    return result.data;
  });
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return api(async () => {
    assertSameOrigin(request);
    const orgId = uuid.parse((await params).orgId),
      userId = uuid.parse(request.nextUrl.searchParams.get('userId'));
    const { client } = await membership(orgId, ['owner', 'admin']);
    const result = await client.rpc('remove_member', { p_org_id: orgId, p_user_id: userId });
    databaseError(result.error);
    return { ok: true };
  });
}
