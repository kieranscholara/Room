import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createDemoScene } from '@roomsell/scene-core';
import type { TenantJob } from '../apps/web/lib/jobs-service';

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  queries: [] as { table: string; filters: [string, unknown][] }[],
  projectContext: vi.fn(),
  projectEditor: vi.fn(),
  enqueueJob: vi.fn(),
  openAiDesign: vi.fn(),
  downloadPhoto: vi.fn(),
  permission: true,
}));
vi.mock('server-only', () => ({}));
vi.mock('../apps/web/lib/local-testing', () => ({ testingEnabled: () => true }));
vi.mock('../apps/web/lib/ai-provider', () => ({
  openAiConfigured: () => true,
  openAiDesign: mocks.openAiDesign,
}));
vi.mock('../apps/web/lib/project-service', () => ({
  projectContext: mocks.projectContext,
  projectEditor: mocks.projectEditor,
}));
vi.mock('../apps/web/lib/jobs-service', () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock('../apps/web/lib/supabase-server', () => ({
  roles: ['owner', 'admin', 'salesperson', 'designer', 'customer'],
  databaseError: (error: unknown) => {
    if (error) throw error;
  },
  adminClient: () => ({
    storage: { from: () => ({ download: mocks.downloadPhoto }) },
    rpc: async (name: string) => ({
      data: name === 'actor_can_edit_project' ? mocks.permission : {},
      error: null,
    }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id } }, error: null }) } },
    from: (table: string) => {
      const query = { table, filters: [] as [string, unknown][] };
      mocks.queries.push(query);
      const result = (single = false) => {
        const rows = (mocks.tables[table] ?? []).filter((row) =>
          query.filters.every(([key, value]) =>
            Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
          ),
        );
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: (key: string, value: unknown) => {
          query.filters.push([key, value]);
          return builder;
        },
        in: (key: string, value: unknown[]) => {
          query.filters.push([key, value]);
          return builder;
        },
        single: async () => result(true),
        maybeSingle: async () => result(true),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(resolve(result())),
      };
      return builder;
    },
  }),
}));
import { executeDesignJob, queueDesignAssistance } from '../apps/web/lib/design-assistant-service';

function fixture() {
  const scene = createDemoScene(),
    projectId = randomUUID(),
    organisationId = randomUUID(),
    actorId = randomUUID(),
    referenceId = randomUUID();
  const project = { id: projectId, organisation_id: organisationId, currency: 'EUR', budget_minor: 100000 };
  const context = { user: { id: actorId }, project, role: 'owner', canEdit: true };
  mocks.projectContext.mockResolvedValue(context);
  mocks.projectEditor.mockResolvedValue({ read: async () => ({ scene }) });
  mocks.enqueueJob.mockImplementation(async (_org, _project, _actor, _kind, payload) => ({ payload }));
  mocks.tables = {
    projects: [project],
    organisation_members: [{ organisation_id: organisationId, user_id: actorId, role: 'owner' }],
    room_references: [{ id: referenceId, project_id: projectId, organisation_id: organisationId }],
    photo_workspaces: [
      {
        reference_id: referenceId,
        project_id: projectId,
        organisation_id: organisationId,
        revision: 3,
        calibration: null,
        regions: [],
        background_reference_id: null,
      },
    ],
    retailer_pricing_policies: [
      {
        organisation_id: organisationId,
        revision: 1,
        policy: {
          version: 1,
          currency: 'EUR',
          taxMode: 'exclusive',
          taxRateBps: 2000,
          rounding: 'invoice',
          discountBps: 0,
          deliveryMinor: 500,
          installationMinor: 0,
          feesTaxable: true,
        },
      },
    ],
  };
  const request = {
    brief: 'Complete this client room',
    provider: 'test',
    expectedSceneVersion: scene.version,
    referenceIds: [referenceId],
    idempotencyKey: randomUUID(),
  };
  const job = (payload: Record<string, unknown>): TenantJob => ({
    id: randomUUID(),
    organisation_id: organisationId,
    project_id: projectId,
    actor_id: actorId,
    kind: 'ai_design',
    payload,
    status: 'running',
    attempts: 1,
    lease_token: randomUUID(),
    result: null,
    error_code: null,
    created_at: new Date().toISOString(),
  });
  return { scene, projectId, organisationId, actorId, referenceId, request, job };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = {};
  mocks.queries = [];
  mocks.permission = true;
});
describe('completion advice photograph snapshot authority', () => {
  it('snapshots selected reference revisions server-side for older callers', async () => {
    const f = fixture();
    const result = await queueDesignAssistance(f.projectId, f.request);
    expect(result.payload.photoWorkspaces).toEqual([{ referenceId: f.referenceId, expectedRevision: 3 }]);
    expect(mocks.projectContext).toHaveBeenCalledWith(f.projectId, true);
    for (const query of mocks.queries) {
      expect(query.filters).toContainEqual(['project_id', f.projectId]);
      expect(query.filters).toContainEqual(['organisation_id', f.organisationId]);
    }
  });
  it('rejects a selected reference outside the project or organisation, even for local advice', async () => {
    const f = fixture();
    mocks.tables.room_references[0].organisation_id = randomUUID();
    await expect(queueDesignAssistance(f.projectId, f.request)).rejects.toMatchObject({ status: 404 });
    expect(mocks.enqueueJob).not.toHaveBeenCalled();
  });
  it('rejects a stale requested photo revision before queueing or provider access', async () => {
    const f = fixture();
    await expect(
      queueDesignAssistance(f.projectId, {
        ...f.request,
        photoWorkspaces: [{ referenceId: f.referenceId, expectedRevision: 2 }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.enqueueJob).not.toHaveBeenCalled();
    expect(mocks.openAiDesign).not.toHaveBeenCalled();
  });
  it('records revision zero for an uploaded image without reviewed selections', async () => {
    const f = fixture();
    mocks.tables.photo_workspaces = [];
    const result = await queueDesignAssistance(f.projectId, f.request);
    expect(result.payload.photoWorkspaces).toEqual([{ referenceId: f.referenceId, expectedRevision: 0 }]);
  });
  it('rechecks the immutable photo snapshot before doing expensive worker work', async () => {
    const f = fixture();
    const queued = await queueDesignAssistance(f.projectId, f.request);
    mocks.tables.photo_workspaces[0].revision = 4;
    await expect(executeDesignJob(f.job(queued.payload))).rejects.toMatchObject({ status: 409 });
    expect(mocks.openAiDesign).not.toHaveBeenCalled();
    expect(mocks.queries.some((query) => query.table === 'product_variants')).toBe(false);
  });
  it('fails closed when a selected photo is deleted or edit permission revoked', async () => {
    const f = fixture();
    const queued = await queueDesignAssistance(f.projectId, f.request);
    mocks.tables.room_references = [];
    await expect(executeDesignJob(f.job(queued.payload))).rejects.toMatchObject({ status: 404 });
    mocks.permission = false;
    await expect(executeDesignJob(f.job(queued.payload))).rejects.toMatchObject({ status: 403 });
    expect(mocks.openAiDesign).not.toHaveBeenCalled();
  });
  it('returns reviewed known-region suggestions without executing scene or image writes', async () => {
    const f = fixture();
    f.scene.objects = [];
    const regionId = randomUUID();
    mocks.tables.photo_workspaces[0].regions = [
      {
        id: regionId,
        label: 'Existing client chest',
        bounds: { x: 0.2, y: 0.3, width: 0.2, height: 0.4 },
        disposition: 'keep',
        foreground: false,
      },
    ];
    const queued = await queueDesignAssistance(f.projectId, {
      ...f.request,
      brief: 'Remove original furniture and complete the room',
    });
    const result = await executeDesignJob(f.job(queued.payload));
    expect(result.existingFurniture).toEqual([
      {
        referenceId: f.referenceId,
        regionId,
        workspaceRevision: 3,
        label: 'Existing client chest',
        action: 'remove',
        rationale: expect.stringContaining('explicit request'),
      },
    ]);
    expect(result.photoWorkspaces).toEqual([{ referenceId: f.referenceId, expectedRevision: 3 }]);
    expect(result.calculationBasis).toBe('projected_completion');
    expect(mocks.tables.photo_workspaces[0].regions).toMatchObject([{ disposition: 'keep' }]);
    expect(mocks.openAiDesign).not.toHaveBeenCalled();
  });
  it('rejects photo changes occurring during advice before returning actionable suggestions', async () => {
    const f = fixture();
    f.scene.objects = [];
    const queued = await queueDesignAssistance(f.projectId, f.request);
    let reads = 0;
    mocks.projectEditor.mockResolvedValue({
      read: async () => {
        reads += 1;
        if (reads === 2) mocks.tables.photo_workspaces[0].revision = 4;
        return { scene: f.scene };
      },
    });
    await expect(executeDesignJob(f.job(queued.payload))).rejects.toMatchObject({ status: 409 });
    expect(reads).toBe(2);
  });
  it.each([6, 8])(
    'normalizes EXIF orientation %i before sending reviewed photo selections to OpenAI',
    async (orientation) => {
      const f = fixture();
      f.scene.objects = [];
      // The stored sensor image has a red left half and a blue right half. A phone
      // orientation tag makes the displayed photograph portrait, with these halves
      // above/below each other; reviewed normalized bounds use that displayed frame.
      const pixels = Buffer.alloc(64 * 32 * 3);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 64; x++) {
          const offset = (y * 64 + x) * 3;
          pixels[offset] = x < 32 ? 240 : 20;
          pixels[offset + 1] = 20;
          pixels[offset + 2] = x < 32 ? 20 : 240;
        }
      const original = await sharp(pixels, { raw: { width: 64, height: 32, channels: 3 } })
        .withMetadata({ orientation })
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
        .toBuffer();
      expect(await sharp(original).metadata()).toMatchObject({ width: 64, height: 32, orientation });
      mocks.tables.room_references[0].path = `${f.organisationId}/${f.projectId}/${f.referenceId}`;
      const region = {
        id: randomUUID(),
        label: 'Red existing furniture',
        bounds: { x: 0, y: orientation === 6 ? 0 : 0.5, width: 1, height: 0.5 },
        disposition: 'keep',
        foreground: false,
      };
      mocks.tables.photo_workspaces[0].regions = [region];
      mocks.downloadPhoto.mockResolvedValue({ data: new Blob([new Uint8Array(original)]), error: null });
      mocks.openAiDesign.mockResolvedValue({
        summary: 'Keep the reviewed furniture',
        recommendations: [],
        layout: null,
        sceneRemovals: [],
        existingFurniture: [],
      });
      const queued = await queueDesignAssistance(f.projectId, { ...f.request, provider: 'openai' });
      await executeDesignJob(f.job(queued.payload));
      expect(mocks.openAiDesign).toHaveBeenCalledOnce();
      const input = mocks.openAiDesign.mock.calls[0][0];
      expect(input.photoWorkspaces[0].regions).toEqual([region]);
      const prepared = Buffer.from(input.photos[0].base64, 'base64');
      const metadata = await sharp(prepared).metadata();
      expect(metadata).toMatchObject({ width: 32, height: 64 });
      expect(metadata.orientation).toBeUndefined();
      const { data, info } = await sharp(prepared).raw().toBuffer({ resolveWithObject: true });
      const redY = orientation === 6 ? 16 : 48;
      const blueY = orientation === 6 ? 48 : 16;
      const red = (redY * info.width + 16) * info.channels;
      const blue = (blueY * info.width + 16) * info.channels;
      expect(data[red]).toBeGreaterThan(180);
      expect(data[red + 2]).toBeLessThan(70);
      expect(data[blue]).toBeLessThan(70);
      expect(data[blue + 2]).toBeGreaterThan(180);
      expect(mocks.downloadPhoto).toHaveBeenCalledWith(mocks.tables.room_references[0].path);
    },
  );
});
