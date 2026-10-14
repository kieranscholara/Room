import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { api, jsonBody } from '../../../../lib/http-api';
import { testFixture } from '../../../../lib/local-testing';
import { adminClient, serverClient, databaseError } from '../../../../lib/supabase-server';
import { ServiceError } from '../../../../lib/editor-service';
export async function POST(request: NextRequest) {
  return api(async () => {
    const { persona } = z
      .object({ persona: z.enum(['retailer', 'customer', 'consumer']) })
      .strict()
      .parse(await jsonBody(request));
    const fixture = await testFixture(),
      identity = fixture.personas[persona];
    const verified = await adminClient().auth.admin.getUserById(identity.id);
    if (
      verified.error ||
      verified.data.user?.email !== identity.email ||
      !identity.email.endsWith('@boreal-living.test') ||
      verified.data.user.user_metadata.fictional_fixture !== 'boreal-living'
    )
      throw new ServiceError(403, 'Only verified fictional accounts may use this shortcut.');
    const members = await adminClient()
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', identity.id);
    databaseError(members.error);
    if (members.data?.some((row) => row.organisation_id !== fixture.organisationId))
      throw new ServiceError(403, 'Shortcut login is restricted to the isolated fictional accounts.');
    const client = await serverClient();
    const result = await client.auth.signInWithPassword({
      email: identity.email,
      password: identity.password,
    });
    if (result.error || result.data.user?.id !== identity.id)
      throw new ServiceError(503, 'The test account could not sign in. Re-run fixture setup.');
    return {
      redirect:
        persona === 'retailer'
          ? `/workspace?organisation=${fixture.organisationId}&panel=projects`
          : persona === 'customer'
            ? `/projects/${fixture.projectId}`
            : '/marketplace',
      fictional: true,
    };
  });
}
