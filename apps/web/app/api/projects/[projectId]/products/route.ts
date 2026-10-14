import { NextRequest } from 'next/server';
import { api } from '../../../../../lib/http-api';
import { projectContext } from '../../../../../lib/project-service';
import { selectedProjectProducts } from '../../../../../lib/project-catalogue';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  return api(async () => selectedProjectProducts(await projectContext((await params).projectId)));
}
