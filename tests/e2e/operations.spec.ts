import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { localTestPreflight } from '../../scripts/test-preflight.mjs';

test('operational monitoring requires its secret and detects stalled jobs without leaking tenant data', async ({
  request,
}) => {
  expect((await request.get('/api/internal/operations')).status()).toBe(401);
  expect(
    (
      await request.get('/api/internal/operations', { headers: { Authorization: 'Bearer invalid' } })
    ).status(),
  ).toBe(401);
  const status = await localTestPreflight(),
    fixture = JSON.parse(await readFile('.local/e2e-fixtures/boreal.json', 'utf8'));
  const token = await readFile('.local/e2e-fixtures/worker-token', 'utf8');
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const queued = await service.rpc('enqueue_tenant_job', {
    p_org_id: fixture.organisationId,
    p_project_id: fixture.projectId,
    p_actor_id: fixture.personas.retailer.id,
    p_kind: 'ai_design',
    p_payload: { brief: 'Isolated operations check' },
    p_dedupe_key: randomUUID(),
    p_request_hash: createHash('sha256').update('isolated-operations-check').digest('hex'),
  });
  expect(queued.error).toBeNull();
  const db = new Client({ connectionString: status.DB_URL });
  await db.connect();
  try {
    await db.query("update public.tenant_jobs set created_at=now()-interval '10 minutes' where id=$1", [
      queued.data.id,
    ]);
    const response = await request.get('/api/internal/operations', {
      headers: { Authorization: 'Bearer ' + token },
    });
    expect(response.status()).toBe(503);
    const metrics = await response.json();
    expect(metrics.status).toBe('degraded');
    expect(metrics.queued).toBeGreaterThan(0);
    expect(metrics.oldestQueuedSeconds).toBeGreaterThan(300);
    const serialized = JSON.stringify(metrics);
    for (const secret of [
      fixture.organisationId,
      fixture.projectId,
      fixture.personas.retailer.id,
      token,
      queued.data.id,
    ])
      expect(serialized).not.toContain(secret);
    expect(response.headers()['cache-control']).toContain('no-store');
  } finally {
    await db.query('delete from public.tenant_jobs where id=$1', [queued.data.id]);
    await db.end();
  }
});
