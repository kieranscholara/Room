import type { NextRequest } from 'next/server';
import { api } from '../../../../../lib/http-api';
import { projectJobs } from '../../../../../lib/jobs-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(() => params.then(({ projectId }) => projectJobs(projectId)));
}
