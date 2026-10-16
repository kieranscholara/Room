import 'server-only';
import sharp from 'sharp';
import { calibratePhoto } from '@roomsell/geometry';
import { adminClient, databaseError } from './supabase-server';
import { projectContext, projectEditor } from './project-service';
import { ServiceError } from './editor-service';
import { photoStateSchema, photoWriteSchema, type PhotoWorkspace } from './photo-contract';
import { uuid } from './account-schemas';
export async function sourcePhoto(projectId: string, referenceId: string) {
  const result = await adminClient()
    .from('room_references')
    .select('*')
    .eq('id', referenceId)
    .eq('project_id', projectId)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Room photograph not found.');
  const image = await adminClient().storage.from('room-references').download(result.data.path);
  if (image.error || !image.data) throw new ServiceError(404, 'Room photograph content unavailable.');
  const normalized = await sharp(Buffer.from(await image.data.arrayBuffer()), { limitInputPixels: 40000000 })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    row: result.data,
    bytes: normalized.data,
    width: normalized.info.width,
    height: normalized.info.height,
  };
}
export function photoWorkspaceDto(row: Record<string, unknown>): PhotoWorkspace {
  const data = photoStateSchema.parse({
    calibration: row.calibration,
    regions: row.regions,
    backgroundReferenceId: row.background_reference_id,
  });
  return {
    referenceId: String(row.reference_id),
    projectId: String(row.project_id),
    revision: Number(row.revision),
    ...data,
  };
}
export async function readPhotoWorkspace(projectId: string, referenceId: string) {
  uuid.parse(referenceId);
  const context = await projectContext(projectId);
  const reference = await context.client
    .from('room_references')
    .select('id')
    .eq('id', referenceId)
    .eq('project_id', projectId)
    .maybeSingle();
  databaseError(reference.error);
  if (!reference.data) throw new ServiceError(404, 'Room photograph not found.');
  const result = await context.client
    .from('photo_workspaces')
    .select('*')
    .eq('reference_id', referenceId)
    .maybeSingle();
  databaseError(result.error);
  return result.data
    ? photoWorkspaceDto(result.data)
    : ({
        referenceId,
        projectId,
        revision: 0,
        calibration: null,
        regions: [],
        backgroundReferenceId: null,
      } satisfies PhotoWorkspace);
}
export async function writePhotoWorkspace(projectId: string, referenceId: string, input: unknown) {
  uuid.parse(referenceId);
  const body = photoWriteSchema.parse(input),
    context = await projectContext(projectId, true);
  if (body.calibration) {
    const scene = (await (await projectEditor(context)).read()).scene;
    if (
      !scene.room.measurementsConfirmed ||
      scene.room.width !== body.calibration.roomWidth ||
      scene.room.depth !== body.calibration.roomDepth
    )
      throw new ServiceError(409, 'Room measurements changed. Calibrate again.');
    const source = await sourcePhoto(projectId, referenceId);
    if (body.calibration.imageWidth !== source.width || body.calibration.imageHeight !== source.height)
      throw new ServiceError(422, 'Photo dimensions changed. Reload the original image.');
    try {
      const camera = calibratePhoto(body.calibration);
      if (camera.position[1] > scene.room.height)
        throw new Error('Camera height exceeds the confirmed room height.');
    } catch (error) {
      throw new ServiceError(422, error instanceof Error ? error.message : 'Invalid calibration.');
    }
  }
  const result = await adminClient().rpc('write_photo_workspace', {
    p_project_id: projectId,
    p_reference_id: referenceId,
    p_actor_id: context.user.id,
    p_expected_revision: body.expectedRevision,
    p_body: body,
  });
  databaseError(result.error);
  return photoWorkspaceDto(result.data);
}
