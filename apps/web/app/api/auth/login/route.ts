import { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../lib/http-api';
import { serverClient } from '../../../../lib/supabase-server';
import { credentialsSchema } from '../../../../lib/account-schemas';
import { ServiceError } from '../../../../lib/editor-service';
export async function POST(request: NextRequest) {
  return api(async () => {
    const body = credentialsSchema.parse(await jsonBody(request));
    const client = await serverClient();
    const { data, error } = await client.auth.signInWithPassword(body);
    if (error || !data.user)
      throw new ServiceError(
        error?.status === 429 ? 429 : 401,
        'Unable to sign in. Check your email/password and confirm your email if required.',
      );
    return { user: { id: data.user.id, email: data.user.email } };
  });
}
