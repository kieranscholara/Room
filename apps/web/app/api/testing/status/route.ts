import { api } from '../../../../lib/http-api';
import { testFixture } from '../../../../lib/local-testing';
export async function GET() {
  return api(async () => {
    const fixture = await testFixture();
    return {
      fictional: true,
      name: 'Boreal Living',
      organisationId: fixture.organisationId,
      projectId: fixture.projectId,
      consumerProjectId: fixture.consumerProjectId ?? null,
    };
  });
}
