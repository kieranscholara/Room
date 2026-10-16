import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../../../lib/http-api';
import { photoJobs, queuePhotoJob } from '../../../../../../../lib/photo-jobs-service';
type Context = { params: Promise<{ projectId: string; referenceId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const p = await params;
    return photoJobs(p.projectId, p.referenceId);
  });
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(async () => {
    const p = await params;
    return queuePhotoJob(p.projectId, p.referenceId, await jsonBody(request));
  });
}
