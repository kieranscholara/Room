import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { validateProductAsset, AssetValidationError } from '@roomsell/catalogue/assets';
import { boundedMultipart } from './catalogue-service';
import { projectContext } from './project-service';
import { adminClient, databaseError } from './supabase-server';
import { ServiceError } from './editor-service';
import { enqueueJob } from './jobs-service';
import { uuid } from './account-schemas';
interface ReferenceRow {
  id: string;
  project_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  path: string;
}
function referenceDto(row: ReferenceRow) {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    url: `/api/projects/${row.project_id}/references/${row.id}`,
  };
}
export async function listRoomReferences(projectId: string) {
  const context = await projectContext(projectId);
  const result = await context.client
    .from('room_references')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at');
  databaseError(result.error);
  return (result.data ?? []).map((row) => referenceDto(row as ReferenceRow));
}
export async function uploadRoomReference(projectId: string, request: NextRequest) {
  const context = await projectContext(projectId, true);
  const form = await boundedMultipart(request, 10 * 1024 * 1024 + 16 * 1024);
  if ([...form.keys()].some((key) => key !== 'file') || form.getAll('file').length !== 1)
    throw new ServiceError(400, 'Upload one room photograph.');
  const file = form.get('file');
  if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024 || file.name.length > 255)
    throw new ServiceError(413, 'Choose a room photograph up to 10 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let validated;
  try {
    validated = await validateProductAsset(bytes, { fileName: file.name });
  } catch (error) {
    if (error instanceof AssetValidationError) throw new ServiceError(422, error.message);
    throw error;
  }
  if (validated.kind !== 'image') throw new ServiceError(422, 'Room references must be photographs.');
  const id = randomUUID(),
    path = `${context.project.organisation_id}/${projectId}/${id}`,
    admin = adminClient();
  const stored = await admin.storage
    .from('room-references')
    .upload(path, bytes, { contentType: validated.mimeType, upsert: false });
  if (stored.error) throw new ServiceError(500, 'Room photograph could not be stored.');
  try {
    const saved = await admin.rpc('room_reference_write', {
      p_project_id: projectId,
      p_actor_id: context.user.id,
      p_reference_id: id,
      p_asset: { path, name: file.name, mimeType: validated.mimeType, sizeBytes: validated.sizeBytes },
    });
    databaseError(saved.error);
    return referenceDto(saved.data as ReferenceRow);
  } catch (error) {
    await admin.storage.from('room-references').remove([path]);
    throw error;
  }
}
export async function downloadRoomReference(projectId: string, id: string) {
  uuid.parse(id);
  const context = await projectContext(projectId);
  const result = await context.client
    .from('room_references')
    .select('*')
    .eq('project_id', projectId)
    .eq('id', id)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Room photograph not found.');
  const row = result.data as ReferenceRow;
  const file = await adminClient().storage.from('room-references').download(row.path);
  if (file.error || !file.data) throw new ServiceError(404, 'Room photograph content unavailable.');
  return new Response(file.data.stream(), {
    headers: {
      'Content-Type': row.mime_type,
      'Content-Length': String(row.size_bytes),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function deleteRoomReference(projectId: string, id: string) {
  uuid.parse(id);
  const context = await projectContext(projectId, true);
  const admin = adminClient();
  const removed = await admin.rpc('room_reference_write', {
    p_project_id: projectId,
    p_actor_id: context.user.id,
    p_reference_id: id,
    p_asset: null,
  });
  databaseError(removed.error);
  const path = (removed.data as ReferenceRow).path;
  const result = await admin.storage.from('room-references').remove([path]);
  if (result.error)
    await enqueueJob(context.project.organisation_id, projectId, context.user.id, 'cleanup_storage', {
      bucket: 'room-references',
      path,
    });
  return { removed: true, cleanupPending: Boolean(result.error) };
}
