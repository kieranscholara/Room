import 'server-only';
import { z } from 'zod';
import { projectContext, projectEditor } from './project-service';
import { adminClient, databaseError } from './supabase-server';
import { readPhotoWorkspace } from './photo-service';
import { enqueueJob, jobDto } from './jobs-service';
import { openAiConfigured } from './ai-provider';
import { ServiceError } from './editor-service';
import {
  compositionWriteSchema,
  photoLayerSchema,
  photoProofSchema,
  renderPhotoSchema,
  type PhotoComposition,
  type PhotoProof,
} from './photo-image-contract';

export function compositionDto(row: Record<string, unknown>): PhotoComposition {
  return {
    referenceId: String(row.reference_id),
    revision: Number(row.revision),
    sceneVersion: Number(row.scene_version),
    photoRevision: Number(row.photo_revision),
    layers: z.array(photoLayerSchema).parse(row.layers),
    renderJobId: row.render_job_id as string | null,
    renderedReferenceId: row.rendered_reference_id as string | null,
    imageSha256: row.image_sha256 as string | null,
    confirmed: Boolean(row.confirmed_at),
  };
}
export async function readComposition(projectId: string, referenceId: string) {
  await readPhotoWorkspace(projectId, referenceId);
  const context = await projectContext(projectId);
  const result = await context.client
    .from('photo_compositions')
    .select('*')
    .eq('project_id', projectId)
    .eq('reference_id', referenceId)
    .maybeSingle();
  databaseError(result.error);
  const jobs = await context.client
    .from('tenant_jobs')
    .select('*')
    .eq('project_id', projectId)
    .eq('kind', 'photo_render')
    .contains('payload', { referenceId })
    .order('created_at', { ascending: false })
    .limit(5);
  databaseError(jobs.error);
  return {
    composition: result.data ? compositionDto(result.data) : null,
    openAiConfigured: openAiConfigured(),
    jobs: (jobs.data ?? []).map(jobDto),
  };
}
const revisionSchema = compositionWriteSchema.pick({
  expectedRevision: true,
  expectedSceneVersion: true,
  expectedPhotoRevision: true,
});
export async function changeComposition(projectId: string, referenceId: string, input: unknown) {
  z.uuid().parse(referenceId);
  const request = z
    .discriminatedUnion('action', [
      compositionWriteSchema.extend({ action: z.literal('save') }),
      revisionSchema.extend({ action: z.literal('apply'), jobId: z.uuid() }).strict(),
      revisionSchema.extend({ action: z.literal('confirm') }).strict(),
    ])
    .parse(input);
  const context = await projectContext(projectId, true);
  const { action, ...body } = request;
  const result = await adminClient().rpc('write_photo_composition', {
    p_project_id: projectId,
    p_reference_id: referenceId,
    p_actor_id: context.user.id,
    p_action: action,
    p_body: body,
  });
  databaseError(result.error);
  return compositionDto(result.data);
}
export async function queueCompositionRender(projectId: string, referenceId: string, input: unknown) {
  const request = renderPhotoSchema.parse(input),
    context = await projectContext(projectId, true);
  const { composition } = await readComposition(projectId, referenceId);
  const scene = (await (await projectEditor(context)).read()).scene;
  const workspace = await readPhotoWorkspace(projectId, referenceId);
  if (
    !composition ||
    composition.revision !== request.expectedRevision ||
    composition.sceneVersion !== scene.version ||
    scene.version !== request.expectedSceneVersion ||
    composition.photoRevision !== workspace.revision ||
    workspace.revision !== request.expectedPhotoRevision
  )
    throw new ServiceError(409, 'Save the current photograph and image layers before rendering.');
  if (!composition.layers.length) throw new ServiceError(422, 'Choose at least one catalogue product first.');
  if (request.provider === 'openai' && !openAiConfigured())
    throw new ServiceError(503, 'Configure OpenAI before requesting AI lighting.');
  const checked = await adminClient().rpc('check_photo_layers', {
    p_project_id: projectId,
    p_layers: composition.layers,
  });
  databaseError(checked.error);
  return jobDto(
    await enqueueJob(
      context.project.organisation_id,
      projectId,
      context.user.id,
      'photo_render',
      { ...request, referenceId },
      request.idempotencyKey,
    ),
  );
}
export async function quotationPhotoProof(projectId: string, input: PhotoProof) {
  const proof = photoProofSchema.parse(input),
    { composition } = await readComposition(projectId, proof.referenceId);
  if (
    !composition?.confirmed ||
    composition.revision !== proof.compositionRevision ||
    composition.imageSha256 !== proof.imageSha256 ||
    !composition.renderedReferenceId
  )
    throw new ServiceError(409, 'Render and confirm the current photograph before quoting.');
  const context = await projectContext(projectId),
    scene = (await (await projectEditor(context)).read()).scene;
  const workspace = await readPhotoWorkspace(projectId, proof.referenceId);
  if (scene.version !== composition.sceneVersion || workspace.revision !== composition.photoRevision)
    throw new ServiceError(409, 'The confirmed photograph changed. Render and confirm it again.');
  return proof;
}
