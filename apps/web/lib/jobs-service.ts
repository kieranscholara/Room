import 'server-only';
import { createHash } from 'node:crypto';
import { adminClient, databaseError, membership } from './supabase-server';
import { projectContext } from './project-service';
import { uuid } from './account-schemas';
import { ServiceError } from './editor-service';

export interface TenantJob {
  id: string;
  organisation_id: string;
  project_id: string | null;
  actor_id: string;
  kind:
    | 'ai_design'
    | 'inventory_sync'
    | 'cleanup_storage'
    | 'cleanup_orphans'
    | 'photo_analysis'
    | 'photo_cleanup';
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  lease_token: string | null;
  result: unknown;
  error_code: string | null;
  created_at: string;
}
export function jobDto(job: TenantJob) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    result: job.result,
    errorCode: job.error_code,
    createdAt: job.created_at,
  };
}
export async function enqueueJob(
  orgId: string,
  projectId: string | null,
  actorId: string,
  kind: TenantJob['kind'],
  payload: Record<string, unknown>,
  dedupeKey = crypto.randomUUID(),
) {
  const result = await adminClient().rpc('enqueue_tenant_job', {
    p_org_id: orgId,
    p_project_id: projectId,
    p_actor_id: actorId,
    p_kind: kind,
    p_payload: payload,
    p_dedupe_key: dedupeKey,
    p_request_hash: createHash('sha256').update(JSON.stringify({ kind, projectId, payload })).digest('hex'),
  });
  databaseError(result.error);
  return result.data as TenantJob;
}
export async function projectJobs(projectId: string) {
  const context = await projectContext(projectId);
  const result = await context.client
    .from('tenant_jobs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50);
  databaseError(result.error);
  return (result.data ?? []).map((row) => jobDto(row as TenantJob));
}
export async function organisationJobs(orgId: string) {
  const { client } = await membership(orgId, ['owner', 'admin']);
  const result = await client
    .from('tenant_jobs')
    .select('*')
    .eq('organisation_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  databaseError(result.error);
  return (result.data ?? []).map((row) => jobDto(row as TenantJob));
}
export async function readJob(id: string) {
  uuid.parse(id);
  const { authenticated } = await import('./supabase-server');
  const { client } = await authenticated();
  const result = await client.from('tenant_jobs').select('*').eq('id', id).maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Job not found.');
  return jobDto(result.data as TenantJob);
}
