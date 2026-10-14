import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../lib/http-api';
import { consumerProjects, createConsumerProject } from '../../../../lib/marketplace-service';

export async function GET() {
  return api(consumerProjects);
}
export async function POST(request: NextRequest) {
  return api(async () => createConsumerProject(await jsonBody(request)), 201);
}
