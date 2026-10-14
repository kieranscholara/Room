import type { NextRequest } from 'next/server';
import { api } from '../../../../lib/http-api';
import { readJob } from '../../../../lib/jobs-service';
type Context = { params: Promise<{ jobId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(() => params.then(({ jobId }) => readJob(jobId)));
}
