import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../../lib/http-api';
import { assistantStatus, queueDesignAssistance } from '../../../../../lib/design-assistant-service';
import { projectContext } from '../../../../../lib/project-service';
import { jobDto } from '../../../../../lib/jobs-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    await projectContext((await params).projectId);
    return assistantStatus();
  });
}
export async function POST(request: NextRequest, { params }: Context) {
  return api(
    async () => jobDto(await queueDesignAssistance((await params).projectId, await jsonBody(request))),
    202,
  );
}
