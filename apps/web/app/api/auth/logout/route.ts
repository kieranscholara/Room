import { NextRequest } from 'next/server';
import { api, assertSameOrigin } from '../../../../lib/http-api';
import { serverClient } from '../../../../lib/supabase-server';
import { ServiceError } from '../../../../lib/editor-service';
export async function POST(request: NextRequest) {
  return api(async () => {
    assertSameOrigin(request);
    const client = await serverClient();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw new ServiceError(400, 'Unable to sign out.');
    return { ok: true };
  });
}
