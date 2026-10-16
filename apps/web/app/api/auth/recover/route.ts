import { NextRequest } from 'next/server';
import { z } from 'zod';
import { api, jsonBody } from '../../../../lib/http-api';
import { serverClient } from '../../../../lib/supabase-server';
import { applicationOrigin } from '../../../../lib/public-origin';
import { ServiceError } from '../../../../lib/editor-service';

export async function POST(request: NextRequest) {
  return api(async () => {
    const { email } = z
      .object({ email: z.email().max(254) })
      .strict()
      .parse(await jsonBody(request));
    const client = await serverClient();
    const { error } = await client.auth.resetPasswordForEmail(email.toLowerCase(), {
      redirectTo: `${applicationOrigin(request)}/auth/recovery`,
    });
    if (error)
      throw new ServiceError(
        error.status === 429 ? 429 : 503,
        'Unable to request recovery. Try again later.',
      );
    // Identical response whether or not the email belongs to an account.
    return { message: 'If this email has an account, a recovery link will arrive shortly.' };
  });
}
