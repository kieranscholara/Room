import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { api, jsonBody } from '../../../../../lib/http-api';
import { organisationJobs, enqueueJob, jobDto } from '../../../../../lib/jobs-service';
import { membership } from '../../../../../lib/supabase-server';
type Context = { params: Promise<{ orgId: string }> };
const input = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('inventory_sync'),
      connectionId: z.uuid(),
      expectedRevision: z.number().int().positive(),
      idempotencyKey: z.uuid(),
    })
    .strict(),
  z.object({ kind: z.literal('cleanup_orphans'), idempotencyKey: z.uuid() }).strict(),
]);
export async function GET(_request: NextRequest, { params }: Context) {
  return api(() => params.then(({ orgId }) => organisationJobs(orgId)));
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const { orgId } = await params,
      { user } = await membership(orgId, ['owner', 'admin']),
      requestBody = input.parse(await jsonBody(request)),
      { kind, idempotencyKey, ...payload } = requestBody;
    return jobDto(await enqueueJob(orgId, null, user.id, kind, payload, idempotencyKey));
  }, 202);
}
