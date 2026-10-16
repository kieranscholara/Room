import type { NextRequest } from 'next/server';
import { api } from '../../../../lib/http-api';
import { adminClient, databaseError } from '../../../../lib/supabase-server';
import { assertWorkerAuthorization } from '../../../../lib/worker-service';
import { ServiceError } from '../../../../lib/editor-service';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  return api(async () => {
    await assertWorkerAuthorization(request.headers.get('authorization'));
    try {
      const admin = adminClient(),
        now = Date.now();
      const [queued, running, failed, oldest, staleLeases, pendingSuppliers] = await Promise.all([
        admin.from('tenant_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
        admin.from('tenant_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
        admin
          .from('tenant_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'failed')
          .gte('updated_at', new Date(now - 86400000).toISOString()),
        admin.from('tenant_jobs').select('created_at').eq('status', 'queued').order('created_at').limit(1),
        admin
          .from('tenant_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'running')
          .lt('lease_expires_at', new Date(now).toISOString()),
        admin
          .from('supplier_fulfilments')
          .select('order_id', { count: 'exact', head: true })
          .is('receipt', null)
          .lt('created_at', new Date(now - 300000).toISOString()),
      ]);
      for (const result of [queued, running, failed, oldest, staleLeases, pendingSuppliers])
        databaseError(result.error);
      const oldestQueuedSeconds = oldest.data?.[0]
        ? Math.max(0, Math.floor((now - Date.parse(oldest.data[0].created_at)) / 1000))
        : 0;
      const degraded =
        oldestQueuedSeconds > 300 ||
        Boolean(failed.count) ||
        Boolean(staleLeases.count) ||
        Boolean(pendingSuppliers.count);
      // Operational aggregates only: no tenant IDs, provider bodies, tokens or customer data.
      return Response.json(
        {
          status: degraded ? 'degraded' : 'ok',
          checkedAt: new Date(now).toISOString(),
          queued: queued.count ?? 0,
          running: running.count ?? 0,
          failedLast24Hours: failed.count ?? 0,
          oldestQueuedSeconds,
          expiredLeases: staleLeases.count ?? 0,
          supplierPendingOverFiveMinutes: pendingSuppliers.count ?? 0,
        },
        { status: degraded ? 503 : 200, headers: { 'Cache-Control': 'private, no-store' } },
      );
    } catch {
      throw new ServiceError(503, 'Operational checks are unavailable.');
    }
  });
}
