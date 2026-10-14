import { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../lib/http-api';
import { authenticated, databaseError } from '../../../lib/supabase-server';
import { organisationSchema } from '../../../lib/account-schemas';
export const dynamic = 'force-dynamic';
export async function GET() {
  return api(async () => {
    const { client, user } = await authenticated();
    const result = await client
      .from('organisation_members')
      .select('role, organisation:organisations(id, name, currency)')
      .eq('user_id', user.id);
    databaseError(result.error);
    return (result.data || []).flatMap((row) => {
      const organisation = Array.isArray(row.organisation) ? row.organisation[0] : row.organisation;
      return organisation ? [{ ...organisation, role: row.role }] : [];
    });
  });
}
export async function POST(request: NextRequest) {
  return api(async () => {
    const body = organisationSchema.parse(await jsonBody(request));
    const { client } = await authenticated();
    const result = await client.rpc('create_organisation', { p_name: body.name, p_currency: body.currency });
    databaseError(result.error);
    return { ...result.data, role: 'owner' };
  }, 201);
}
