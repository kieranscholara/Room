import { NextRequest } from 'next/server';
import { uuid } from '../../../../../../lib/account-schemas';
import { api } from '../../../../../../lib/http-api';
import { projectContext } from '../../../../../../lib/project-service';
import { selectedProjectAsset } from '../../../../../../lib/project-catalogue';
type Context = { params: Promise<{ projectId: string; assetId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { projectId, assetId } = await params;
    const { asset, blob } = await selectedProjectAsset(await projectContext(projectId), uuid.parse(assetId));
    return new Response(blob.stream(), {
      headers: {
        'Content-Type': asset.mime_type,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': asset.kind === 'image' ? 'inline' : 'attachment',
      },
    });
  } catch (error) {
    return api(async () => {
      throw error;
    });
  }
}
