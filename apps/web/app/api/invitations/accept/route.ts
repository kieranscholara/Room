import { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../lib/http-api';
import { authenticated, databaseError } from '../../../../lib/supabase-server';
import { invitationTokenSchema } from '../../../../lib/account-schemas';
export async function POST(request: NextRequest) {
  return api(async () => {
    const body = invitationTokenSchema.parse(await jsonBody(request));
    const { client } = await authenticated();
    const result = await client.rpc('accept_invitation', { p_token: body.token });
    databaseError(result.error);
    return result.data;
  });
}
