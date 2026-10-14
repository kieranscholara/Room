import { NextRequest } from 'next/server';
import { api } from '../../../../../../lib/http-api';
import { projectContext, projectEditor } from '../../../../../../lib/project-service';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => {
    const context = await projectContext((await params).projectId);
    return (await projectEditor(context)).revisions();
  });
}
