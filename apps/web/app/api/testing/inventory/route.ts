import type { NextRequest } from 'next/server';
import { api, jsonBody } from '../../../../lib/http-api';
import { testFixture, updateFixtureStock, fixtureDirectory } from '../../../../lib/local-testing';
import { authenticated, membership } from '../../../../lib/supabase-server';
import { readFile } from 'node:fs/promises';
export async function GET() {
  return api(async () => {
    const fixture = await testFixture();
    await membership(fixture.organisationId, ['owner', 'admin']);
    return JSON.parse(await readFile(fixtureDirectory() + '/boreal-stock.json', 'utf8'));
  });
}
export async function POST(request: NextRequest) {
  return api(async () => {
    const { user } = await authenticated();
    return updateFixtureStock(await jsonBody(request), user.id);
  });
}
