import { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../lib/http-api';
import { serverClient } from '../../../../lib/supabase-server';
import { signupSchema } from '../../../../lib/account-schemas';
import { ServiceError } from '../../../../lib/editor-service';
import { applicationOrigin } from '../../../../lib/public-origin';
export async function POST(request: NextRequest) {
  return api(async () => {
    const body = signupSchema.parse(await jsonBody(request));
    const client = await serverClient();
    const { data, error } = await client.auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        data: { displayName: body.displayName },
        emailRedirectTo: `${applicationOrigin(request)}/auth/callback`,
      },
    });
    if (error)
      throw new ServiceError(
        error.status === 429 ? 429 : 400,
        'Unable to create the account. Check the email and password or try again later.',
      );
    return {
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
      requiresEmailConfirmation: !data.session,
    };
  }, 201);
}
