import { NextRequest } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { api, jsonBody, assertSameOrigin } from '../../../../../lib/http-api';
import { membership, databaseError } from '../../../../../lib/supabase-server';
import { invitationSchema, uuid } from '../../../../../lib/account-schemas';
type Context = { params: Promise<{ orgId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId);
    const { client } = await membership(orgId, ['owner', 'admin']);
    const result = await client
      .from('organisation_invitations')
      .select('id,email,role,expires_at,accepted_at,revoked_at')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false });
    databaseError(result.error);
    return (result.data || []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expires_at,
      acceptedAt: i.accepted_at,
      revokedAt: i.revoked_at,
    }));
  });
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId);
    const body = invitationSchema.parse(await jsonBody(request));
    const { client } = await membership(orgId, ['owner', 'admin']);
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const result = await client.rpc('create_invitation', {
      p_org_id: orgId,
      p_email: body.email,
      p_role: body.role,
      p_token_hash: hash,
    });
    databaseError(result.error);
    const origin =
      request.headers.get('origin') || `${request.nextUrl.protocol}//${request.headers.get('host')}`;
    return { id: result.data.id, url: `${origin}/join?token=${token}`, expiresAt: result.data.expires_at };
  }, 201);
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return api(async () => {
    assertSameOrigin(request);
    const orgId = uuid.parse((await params).orgId),
      id = uuid.parse(request.nextUrl.searchParams.get('id'));
    const { client } = await membership(orgId, ['owner', 'admin']);
    const result = await client.rpc('revoke_invitation', { p_org_id: orgId, p_invitation_id: id });
    databaseError(result.error);
    return { ok: true };
  });
}
