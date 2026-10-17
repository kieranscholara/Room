import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { adminClient, databaseError } from './supabase-server';
import { ServiceError, isServiceError } from './editor-service';
import type { TenantJob } from './jobs-service';
import { executeDesignJob } from './design-assistant-service';
import { executePhotoJob } from './photo-jobs-service';
import { executeCompositionJob } from './photo-composition-jobs';
import { testingEnabled, fixtureDirectory } from './local-testing';
export async function assertWorkerAuthorization(header: string | null) {
  let secret = process.env.ROOMSELL_WORKER_TOKEN || process.env.CRON_SECRET;
  if (!secret && testingEnabled()) {
    try {
      secret = await readFile(fixtureDirectory() + '/worker-token', 'utf8');
    } catch {
      /* Explicit local worker setup is optional until seeding. */
    }
  }
  if (!secret || secret.length < 32) throw new ServiceError(503, 'Worker authentication is not configured.');
  const presented = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(secret),
    b = Buffer.from(presented);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new ServiceError(401, 'Worker authentication required.');
}
async function cleanupStorage(job: TenantJob) {
  const bucket = job.payload.bucket,
    path = job.payload.path;
  if (
    !['room-references', 'product-assets'].includes(String(bucket)) ||
    typeof path !== 'string' ||
    !path.startsWith(job.organisation_id + '/') ||
    path.includes('..')
  )
    throw new ServiceError(400, 'Invalid cleanup scope.');
  const admin = adminClient(),
    table = bucket === 'room-references' ? 'room_references' : 'product_assets';
  const linked = await admin.from(table).select('id').eq('path', path).limit(1);
  databaseError(linked.error);
  if (linked.data?.length) return { removed: false, stillLinked: true };
  const result = await admin.storage.from(String(bucket)).remove([path]);
  if (result.error) throw new ServiceError(503, 'Storage cleanup unavailable.');
  return { removed: true };
}
async function cleanupOrphans(job: TenantJob) {
  let removed = 0;
  const admin = adminClient();
  for (const bucket of ['room-references', 'product-assets']) {
    const result = await admin.storage.from(bucket).list(job.organisation_id, { limit: 50 });
    if (result.error) throw new ServiceError(503, 'Storage listing unavailable.'); // Nested paths require a bounded depth-first traversal.
    const folders = (result.data ?? [])
      .filter((item) => !item.id)
      .map((item) => job.organisation_id + '/' + item.name);
    for (const folder of folders.slice(0, 20)) {
      const entries = await admin.storage.from(bucket).list(folder, { limit: 50 });
      if (entries.error) throw new ServiceError(503, 'Storage listing unavailable.');
      for (const entry of entries.data ?? []) {
        if (!entry.id || !entry.created_at || Date.parse(entry.created_at) > Date.now() - 86400000) continue;
        const path = folder + '/' + entry.name;
        const linked = await admin
          .from(bucket === 'room-references' ? 'room_references' : 'product_assets')
          .select('id')
          .eq('path', path)
          .limit(1);
        databaseError(linked.error);
        if (!linked.data?.length) {
          const cleanup = await admin.storage.from(bucket).remove([path]);
          if (cleanup.error) throw new ServiceError(503, 'Storage cleanup unavailable.');
          removed++;
        }
      }
    }
  }
  return { removed };
}
export async function runWorkerBatch(maxJobs = 3) {
  const admin = adminClient();
  const results = [];
  const expired = await admin
    .from('retailer_orders')
    .select('organisation_id')
    .eq('status', 'reserved')
    .lte('expires_at', new Date().toISOString())
    .order('expires_at')
    .limit(100);
  databaseError(expired.error);
  for (const organisationId of [
    ...new Set((expired.data ?? []).map((order) => order.organisation_id)),
  ].sort()) {
    const expiry = await admin.rpc('expire_order_reservations', { p_org_id: organisationId });
    databaseError(expiry.error);
  }
  for (let index = 0; index < maxJobs; index++) {
    const claimed = await admin.rpc('claim_tenant_job');
    databaseError(claimed.error);
    if (!claimed.data) break;
    const job = claimed.data as TenantJob;
    let result: unknown = null,
      errorCode: string | null = null,
      retryable = false;
    try {
      if (job.kind === 'ai_design') result = await executeDesignJob(job);
      else if (job.kind === 'photo_render') result = await executeCompositionJob(job);
      else if (job.kind === 'photo_analysis' || job.kind === 'photo_cleanup')
        result = await executePhotoJob(job);
      else if (job.kind === 'cleanup_storage') result = await cleanupStorage(job);
      else if (job.kind === 'cleanup_orphans') result = await cleanupOrphans(job);
      else if (job.kind === 'inventory_sync') {
        const { syncInventoryForActor } = await import('./inventory-service');
        result = await syncInventoryForActor(
          job.organisation_id,
          String(job.payload.connectionId),
          { expectedRevision: job.payload.expectedRevision },
          job.actor_id,
        );
      } else throw new ServiceError(400, 'Unsupported job kind.');
    } catch (error) {
      const status = isServiceError(error) ? error.status : 500;
      errorCode =
        status === 403
          ? 'permission_revoked'
          : status === 409
            ? 'source_changed'
            : status === 422 || status === 400
              ? 'invalid_request'
              : status === 503
                ? 'provider_unavailable'
                : 'worker_failure';
      retryable = status === 503;
    }
    if (result !== null && Buffer.byteLength(JSON.stringify(result)) > 65536) {
      result = null;
      errorCode = 'result_too_large';
      retryable = false;
    }
    const finished = await admin.rpc('finish_tenant_job', {
      p_job_id: job.id,
      p_lease_token: job.lease_token,
      p_result: result,
      p_error_code: errorCode,
      p_retryable: retryable,
    });
    databaseError(finished.error);
    results.push({ id: job.id, status: finished.data.status });
  }
  return { processed: results.length, jobs: results };
}
