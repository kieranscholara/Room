import 'server-only';
import { createHash } from 'node:crypto';
import { adminClient, databaseError } from './supabase-server';
import { sourcePhoto } from './photo-service';
import { compositionDto } from './photo-composition-service';
import { workerProjectContext } from './design-assistant-service';
import { projectEditor } from './project-service';
import { selectedProjectAsset } from './project-catalogue';
import { renderPhotoSchema } from './photo-image-contract';
import { composeCataloguePhoto } from './photo-composition-renderer';
import { refinePhotoLighting } from './photo-provider';
import type { TenantJob } from './jobs-service';
import { ServiceError } from './editor-service';
import sharp from 'sharp';

export async function executeCompositionJob(job: TenantJob) {
  if (!job.project_id) throw new ServiceError(400, 'A photograph project is required.');
  const { referenceId, ...raw } = job.payload;
  const request = renderPhotoSchema.parse(raw),
    projectId = job.project_id;
  if (typeof referenceId !== 'string') throw new ServiceError(400, 'Photograph required.');
  const context = await workerProjectContext(projectId, job.actor_id),
    admin = adminClient();
  if (context.project.organisation_id !== job.organisation_id)
    throw new ServiceError(403, 'Photograph organisation changed.');
  const get = async () => {
    const row = await admin
      .from('photo_compositions')
      .select('*')
      .eq('project_id', projectId)
      .eq('reference_id', referenceId)
      .maybeSingle();
    databaseError(row.error);
    if (!row.data) throw new ServiceError(409, 'Photograph composition no longer exists.');
    const comp = compositionDto(row.data),
      scene = (await (await projectEditor(context)).read()).scene;
    // Worker authority is already checked; this read still enforces actor/project access.
    const photo = await admin
      .from('photo_workspaces')
      .select('*')
      .eq('project_id', projectId)
      .eq('reference_id', referenceId)
      .single();
    databaseError(photo.error);
    if (
      comp.revision !== request.expectedRevision ||
      scene.version !== request.expectedSceneVersion ||
      photo.data.revision !== request.expectedPhotoRevision ||
      comp.sceneVersion !== scene.version ||
      comp.photoRevision !== photo.data.revision
    )
      throw new ServiceError(409, 'Photograph or furniture changed while rendering.');
    return { comp, scene, photo };
  };
  const { comp, scene } = await get();
  const checked = await admin.rpc('check_photo_layers', { p_project_id: projectId, p_layers: comp.layers });
  databaseError(checked.error);
  const { photoWorkspaceDto } = await import('./photo-service');
  const workspace = photoWorkspaceDto((await get()).photo.data);
  const original = await sourcePhoto(projectId, referenceId),
    background = workspace.backgroundReferenceId
      ? await sourcePhoto(projectId, workspace.backgroundReferenceId)
      : original;
  const images = new Map<string, Buffer>();
  for (const layer of comp.layers) {
    const { asset, blob } = await selectedProjectAsset(context, layer.assetId);
    if (asset.kind !== 'image') throw new ServiceError(422, 'Choose a catalogue photograph, not a model.');
    images.set(layer.assetId, Buffer.from(await blob.arrayBuffer()));
  }
  let render = await composeCataloguePhoto(background.bytes, scene, workspace, comp.layers, images);
  if (request.provider === 'openai') {
    const lighting = await refinePhotoLighting(render.bytes, scene, workspace);
    // Reinsert the original cutouts over the reviewed lighting; AI cannot redraw the SKU.
    render = await composeCataloguePhoto(lighting, scene, workspace, comp.layers, images, false);
  }
  await workerProjectContext(projectId, job.actor_id);
  await get();
  if (render.bytes.length > 10 * 1024 * 1024) throw new ServiceError(422, 'Final photograph exceeds 10 MiB.');
  const path = `${job.organisation_id}/${projectId}/${job.id}`;
  const existing = await admin
    .from('room_references')
    .select('id,path')
    .eq('id', job.id)
    .eq('project_id', projectId)
    .maybeSingle();
  databaseError(existing.error);
  if (!existing.data) {
    const upload = await admin.storage
      .from('room-references')
      .upload(path, render.bytes, { contentType: 'image/png', upsert: false });
    if (upload.error) {
      const staged = await admin.storage.from('room-references').download(path);
      if (staged.error || !staged.data) throw new ServiceError(503, 'Final photograph storage unavailable.');
      const recovered = Buffer.from(await staged.data.arrayBuffer()),
        metadata = await sharp(recovered, { limitInputPixels: 16000000 }).metadata();
      if (
        metadata.format !== 'png' ||
        metadata.width !== original.width ||
        metadata.height !== original.height ||
        recovered.length > 10 * 1024 * 1024
      )
        throw new ServiceError(409, 'The staged photograph could not be verified.');
      render = { bytes: recovered, imageSha256: createHash('sha256').update(recovered).digest('hex') };
    }
    const saved = await admin.rpc('room_reference_write', {
      p_project_id: projectId,
      p_actor_id: job.actor_id,
      p_reference_id: job.id,
      p_asset: {
        path,
        name: `Room design — ${original.row.name}`.slice(0, 255),
        mimeType: 'image/png',
        sizeBytes: render.bytes.length,
      },
    });
    databaseError(saved.error);
  } else {
    if (existing.data.path !== path) throw new ServiceError(409, 'Stored image scope changed.');
    const stored = await admin.storage.from('room-references').download(path);
    if (stored.error || !stored.data) throw new ServiceError(503, 'Stored photograph unavailable.');
    render.imageSha256 = createHash('sha256')
      .update(Buffer.from(await stored.data.arrayBuffer()))
      .digest('hex');
  }
  return {
    referenceId,
    compositionRevision: comp.revision,
    sceneVersion: scene.version,
    photoRevision: workspace.revision,
    renderedReferenceId: job.id,
    imageSha256: render.imageSha256,
    provider: request.provider,
  };
}
