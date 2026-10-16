import { NextRequest } from 'next/server';
import { z } from 'zod';
import { api, jsonBody } from '../../../../lib/http-api';
import { authenticated } from '../../../../lib/supabase-server';
import { ServiceError } from '../../../../lib/editor-service';

export async function POST(request: NextRequest) {
  return api(async () => {
    const { password } = z
      .object({ password: z.string().min(12).max(128) })
      .strict()
      .parse(await jsonBody(request));
    const { client } = await authenticated();
    const { error } = await client.auth.updateUser({ password });
    if (error)
      throw new ServiceError(
        error.status === 429 ? 429 : 400,
        'Unable to update the password. Use a new password or request a fresh recovery link.',
      );
    await client.auth.signOut({ scope: 'global' });
    return { updated: true };
  });
}
