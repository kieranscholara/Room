import type { NextRequest } from 'next/server';
import { api } from '../../../../../lib/http-api';
import { assertWorkerAuthorization, runWorkerBatch } from '../../../../../lib/worker-service';
export const maxDuration = 60;
async function run(request: NextRequest) {
  return api(async () => {
    await assertWorkerAuthorization(request.headers.get('authorization'));
    return runWorkerBatch(1);
  });
}
export const POST = run;
export const GET = run;
