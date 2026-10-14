import { NextRequest } from 'next/server';
import { api, jsonBody, assertSameOrigin } from '../../../../../lib/http-api';
import { projectContext } from '../../../../../lib/project-service';
import { membership, databaseError } from '../../../../../lib/supabase-server';
import { projectAccessSchema } from '../../../../../lib/business-schemas';
import { uuid } from '../../../../../lib/account-schemas';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const context = await projectContext((await params).projectId);
    const { client } = await membership(context.project.organisation_id, ['owner', 'admin']);
    const result = await client
      .from('project_access')
      .select('user_id,can_edit')
      .eq('project_id', context.project.id);
    databaseError(result.error);
    return (result.data || []).map((a) => ({ userId: a.user_id, canEdit: a.can_edit }));
  });
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const body = projectAccessSchema.parse(await jsonBody(request));
    const context = await projectContext((await params).projectId);
    const { client } = await membership(context.project.organisation_id, ['owner', 'admin']);
    const result = await client.rpc('grant_project_access', {
      p_org_id: context.project.organisation_id,
      p_project_id: context.project.id,
      p_user_id: body.userId,
      p_can_edit: body.canEdit,
    });
    databaseError(result.error);
    return result.data;
  });
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return api(async () => {
    assertSameOrigin(request);
    const userId = uuid.parse(request.nextUrl.searchParams.get('userId'));
    const context = await projectContext((await params).projectId);
    const { client } = await membership(context.project.organisation_id, ['owner', 'admin']);
    const result = await client.rpc('revoke_project_access', {
      p_org_id: context.project.organisation_id,
      p_project_id: context.project.id,
      p_user_id: userId,
    });
    databaseError(result.error);
    return { ok: true };
  });
}
