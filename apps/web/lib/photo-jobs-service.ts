import 'server-only';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { photoAnalysisSchema, photoJobSchema, photoStateSchema, type PhotoWorkspace } from './photo-contract';
import { sourcePhoto, photoWorkspaceDto } from './photo-service';
import { analysePhoto, cleanupPhoto, composePhotoCleanup, preparePhotoEdit } from './photo-provider';
import { openAiConfigured } from './ai-provider';
import { testingEnabled, testFixture } from './local-testing';
import { projectContext } from './project-service';
import { workerProjectContext } from './design-assistant-service';
import { adminClient, databaseError } from './supabase-server';
import { enqueueJob, jobDto, type TenantJob } from './jobs-service';
import { ServiceError } from './editor-service';
import { uuid } from './account-schemas';
async function workspace(projectId: string, referenceId: string): Promise<PhotoWorkspace> {
  const r = await adminClient()
    .from('photo_workspaces')
    .select('*')
    .eq('reference_id', referenceId)
    .eq('project_id', projectId)
    .maybeSingle();
  databaseError(r.error);
  return r.data
    ? photoWorkspaceDto(r.data)
    : { projectId, referenceId, revision: 0, calibration: null, regions: [], backgroundReferenceId: null };
}
async function fixturePhoto(orgId: string, source: Buffer) {
  if (!testingEnabled()) throw new ServiceError(403, 'The local photo fixture adapter is disabled.');
  const fixture = await testFixture();
  if (fixture.organisationId !== orgId)
    throw new ServiceError(403, 'This adapter is restricted to the fictional retailer.');
  const directory = resolve(
    /* turbopackIgnore: true */ process.cwd(),
    '../../fixtures/boreal-living/photo-demo',
  );
  const bytes = await sharp(await readFile(resolve(directory, 'room.png')))
    .rotate()
    .png()
    .toBuffer();
  if (createHash('sha256').update(bytes).digest('hex') !== createHash('sha256').update(source).digest('hex'))
    throw new ServiceError(
      422,
      'The local adapter only handles the labelled synthetic measurement demonstration. Select that photograph, or use OpenAI for another photo.',
    );
  return {
    directory,
    analysis: photoAnalysisSchema.parse(
      JSON.parse(await readFile(resolve(directory, 'analysis.json'), 'utf8')),
    ),
  };
}
export async function photoJobs(projectId: string, referenceId: string) {
  uuid.parse(referenceId);
  const context = await projectContext(projectId);
  const reference = await context.client
    .from('room_references')
    .select('id')
    .eq('project_id', projectId)
    .eq('id', referenceId)
    .maybeSingle();
  databaseError(reference.error);
  if (!reference.data) throw new ServiceError(404, 'Photograph not found.');
  const r = await context.client
    .from('tenant_jobs')
    .select('*')
    .eq('project_id', projectId)
    .in('kind', ['photo_analysis', 'photo_cleanup'])
    .contains('payload', { referenceId })
    .order('created_at', { ascending: false })
    .limit(10);
  databaseError(r.error);
  return {
    openAiConfigured: openAiConfigured(),
    testAdapterEnabled: testingEnabled(),
    jobs: (r.data ?? []).map((row) => jobDto(row as TenantJob)),
  };
}
export async function queuePhotoJob(projectId: string, referenceId: string, input: unknown) {
  const request = photoJobSchema.parse(input),
    context = await projectContext(projectId, true);
  if (request.referenceId !== referenceId) throw new ServiceError(400, 'Photograph identity mismatch.');
  const source = await sourcePhoto(projectId, referenceId),
    state = await workspace(projectId, referenceId);
  if (request.expectedRevision !== state.revision)
    throw new ServiceError(409, 'Photo selections changed. Reload before continuing.');
  if (request.provider === 'openai' && !openAiConfigured())
    throw new ServiceError(503, 'Configure the OpenAI API key securely first.');
  if (request.provider === 'test') await fixturePhoto(context.project.organisation_id, source.bytes);
  const regions = state.regions.filter((r) => r.disposition === 'remove');
  if (request.kind === 'photo_cleanup' && (!regions.length || regions.length > 8))
    throw new ServiceError(422, 'Select between one and eight reviewed areas to remove.');
  return jobDto(
    await enqueueJob(
      context.project.organisation_id,
      projectId,
      context.user.id,
      request.kind,
      { ...request, regions: state.regions },
      request.idempotencyKey,
    ),
  );
}
export async function executePhotoJob(job: TenantJob) {
  if (!job.project_id) throw new ServiceError(400, 'A project is required.');
  const { regions: rawRegions, ...raw } = job.payload,
    request = photoJobSchema.parse(raw),
    regions = photoStateSchema.shape.regions.parse(rawRegions);
  const context = await workerProjectContext(job.project_id, job.actor_id);
  if (context.project.organisation_id !== job.organisation_id || request.kind !== job.kind)
    throw new ServiceError(403, 'Photograph job scope changed.');
  const state = await workspace(job.project_id, request.referenceId);
  if (state.revision !== request.expectedRevision)
    throw new ServiceError(409, 'Photograph selections changed.');
  const source = await sourcePhoto(job.project_id, request.referenceId),
    fixture = request.provider === 'test' ? await fixturePhoto(job.organisation_id, source.bytes) : null;
  const result = {
    referenceId: request.referenceId,
    workspaceRevision: state.revision,
    provider: request.provider,
    fictionalAdapter: Boolean(fixture),
  };
  if (job.kind === 'photo_analysis')
    return { ...result, analysis: fixture?.analysis ?? (await analysePhoto(source.bytes)) };
  const admin = adminClient(),
    path = `${job.organisation_id}/${job.project_id}/${job.id}`;
  const previous = await admin
    .from('room_references')
    .select('id')
    .eq('project_id', job.project_id)
    .eq('id', job.id)
    .maybeSingle();
  databaseError(previous.error);
  if (!previous.data) {
    let bytes: Buffer;
    if (fixture) {
      const empty = await readFile(resolve(fixture.directory, 'empty.png'));
      const square = await preparePhotoEdit(empty, regions);
      bytes = await composePhotoCleanup(source.bytes, square.image, regions);
    } else bytes = await cleanupPhoto(source.bytes, regions);
    if (bytes.length > 10 * 1024 * 1024)
      throw new ServiceError(422, 'Edited photograph exceeds the private storage limit.');
    await workerProjectContext(job.project_id, job.actor_id);
    if ((await workspace(job.project_id, request.referenceId)).revision !== state.revision)
      throw new ServiceError(409, 'Photograph selections changed during cleanup.');
    const upload = await admin.storage
      .from('room-references')
      .upload(path, bytes, { contentType: 'image/png', upsert: false });
    if (upload.error) throw new ServiceError(503, 'Edited photograph could not be stored.');
    const saved = await admin.rpc('room_reference_write', {
      p_project_id: job.project_id,
      p_actor_id: job.actor_id,
      p_reference_id: job.id,
      p_asset: {
        path,
        name: `Reviewed cleanup — ${source.row.name}`.slice(0, 255),
        mimeType: 'image/png',
        sizeBytes: bytes.length,
      },
    });
    databaseError(saved.error);
  }
  return { ...result, generatedReferenceId: job.id };
}
