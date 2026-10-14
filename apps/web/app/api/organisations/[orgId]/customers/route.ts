import { NextRequest } from 'next/server';
import { api, jsonBody, assertSameOrigin } from '../../../../../lib/http-api';
import { membership, databaseError } from '../../../../../lib/supabase-server';
import { uuid } from '../../../../../lib/account-schemas';
import { customerInputSchema } from '../../../../../lib/business-schemas';
type Context = { params: Promise<{ orgId: string }> };
const staff = ['owner', 'admin', 'salesperson', 'designer'] as const;
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId);
    const { client } = await membership(orgId, staff);
    const result = await client
      .from('customers')
      .select('*')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .limit(500);
    databaseError(result.error);
    return result.data;
  });
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId);
    const body = customerInputSchema.parse(await jsonBody(request));
    const { client } = await membership(orgId, staff);
    const result = await client
      .from('customers')
      .insert({ organisation_id: orgId, ...body, email: body.email || null, phone: body.phone || null })
      .select()
      .single();
    databaseError(result.error);
    return result.data;
  }, 201);
}
export async function PATCH(request: NextRequest, { params }: Context) {
  return api(async () => {
    const orgId = uuid.parse((await params).orgId),
      id = uuid.parse(request.nextUrl.searchParams.get('id'));
    const body = customerInputSchema.parse(await jsonBody(request));
    const { client } = await membership(orgId, staff);
    const result = await client
      .from('customers')
      .update({
        ...body,
        email: body.email || null,
        phone: body.phone || null,
        updated_at: new Date().toISOString(),
      })
      .eq('organisation_id', orgId)
      .eq('id', id)
      .select()
      .single();
    databaseError(result.error);
    return result.data;
  });
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return api(async () => {
    assertSameOrigin(request);
    const orgId = uuid.parse((await params).orgId),
      id = uuid.parse(request.nextUrl.searchParams.get('id'));
    const { client } = await membership(orgId, ['owner', 'admin']);
    const result = await client
      .from('customers')
      .delete()
      .eq('organisation_id', orgId)
      .eq('id', id)
      .select('id');
    databaseError(result.error);
    return { removed: result.data?.length === 1 };
  });
}
