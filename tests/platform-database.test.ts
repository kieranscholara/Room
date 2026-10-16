import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDemoScene, type Scene } from '@roomsell/scene-core';
import { priceQuotation } from '@roomsell/pricing';
import { quotationSourceSchema } from '../apps/web/lib/quotation-schemas';
import { localTestPreflight } from '../scripts/test-preflight.mjs';
function ok<T extends { data: unknown; error: { message: string } | null }>(r: T): NonNullable<T['data']> {
  if (r.error || r.data === null) throw new Error(r.error?.message ?? 'Missing result');
  return r.data as NonNullable<T['data']>;
}
interface Actor {
  id: string;
  client: SupabaseClient;
}
describe.skipIf(process.env.ROOMSELL_RUN_DATABASE_TESTS !== '1')(
  'private references, leased jobs, stock orders and consumer ownership',
  () => {
    let service: SupabaseClient,
      anonymous: SupabaseClient,
      db: Client,
      owner: Actor,
      foreign: Actor,
      buyer: Actor,
      other: Actor,
      consumer: Actor,
      org: string,
      foreignOrg: string,
      product: string,
      variant: string;
    const users: string[] = [],
      paths: string[] = [],
      consumerIds: string[] = [];
    const policy = {
      version: 1,
      currency: 'EUR',
      taxMode: 'exclusive',
      taxRateBps: 1800,
      rounding: 'invoice',
      discountBps: 0,
      deliveryMinor: 100,
      installationMinor: 0,
      feesTaxable: true,
    };
    async function project() {
      const scene = createDemoScene();
      scene.objects = [
        {
          id: randomUUID(),
          variantId: variant,
          sku: 'PLATFORM-A',
          name: 'Platform bedside',
          category: 'bedside',
          dimensions: { width: 0.5, depth: 0.5, height: 1 },
          color: '#112233',
          solid: true,
          transform: { x: 2, y: 0, z: 2, rotation: 0 },
          locks: { position: true, rotation: true, product: true },
        },
      ];
      scene.groups = [];
      const result = ok(
        await service.rpc('create_project', {
          p_org_id: org,
          p_actor_id: owner.id,
          p_customer_id: null,
          p_name: 'Isolated platform test',
          p_budget_minor: 100000,
          p_currency: 'EUR',
          p_style: '',
          p_room_type: 'bedroom',
          p_scene: scene,
        }),
      );
      for (const actor of [buyer, other])
        ok(
          await owner.client.rpc('grant_project_access', {
            p_org_id: org,
            p_project_id: result.project.id,
            p_user_id: actor.id,
            p_can_edit: true,
            p_can_order: true,
          }),
        );
      return result as { project: { id: string }; scene: { data: Scene; id: string } };
    }
    async function quote(projectId: string) {
      const source = quotationSourceSchema.parse(
        ok(
          await service.rpc('quotation_source', {
            p_project_id: projectId,
            p_actor_id: owner.id,
            p_expected_scene_version: 0,
            p_expected_policy_revision: 1,
          }),
        ),
      );
      return ok(
        await service.rpc('issue_quotation', {
          p_project_id: projectId,
          p_actor_id: owner.id,
          p_expected_scene_version: 0,
          p_expected_policy_revision: 1,
          p_idempotency_key: randomUUID(),
          p_request_hash: createHash('sha256').update(JSON.stringify(source)).digest('hex'),
          p_source: source,
          p_calculation: priceQuotation({
            policy: source.policy,
            items: source.items.map(({ variantId, sku, name, quantity, unitPriceMinor, currency }) => ({
              variantId,
              sku,
              name,
              quantity,
              unitPriceMinor,
              currency,
            })),
          }),
        }),
      );
    }
    function reserve(projectId: string, quoteId: string, actor = buyer.id, key = randomUUID()) {
      return service.rpc('reserve_quotation_order', {
        p_project_id: projectId,
        p_actor_id: actor,
        p_quotation_id: quoteId,
        p_idempotency_key: key,
      });
    }
    function transition(id: string, status: string, action: string, actor = buyer.id) {
      return service.rpc('transition_retailer_order', {
        p_order_id: id,
        p_actor_id: actor,
        p_expected_status: status,
        p_action: action,
      });
    }
    async function supplierOrder() {
      const p = await project(),
        q = await quote(p.project.id),
        order = ok(await reserve(p.project.id, q.id));
      ok(await transition(order.id, 'reserved', 'confirm'));
      const connection = randomUUID();
      await db.query(
        "insert into public.inventory_connections(id,organisation_id,name,provider,endpoint,order_endpoint) values($1,$2,'Fictional supplier contract','custom_rest','https://inventory.boreal-living.test/snapshot','https://inventory.boreal-living.test/fulfilments')",
        [connection, org],
      );
      await db.query(
        "insert into public.inventory_mappings(organisation_id,connection_id,external_product_id,external_variant_id,product_id,variant_id) values($1,$2,'external','external-v',$3,$4)",
        [org, connection, product, variant],
      );
      return { order, connection };
    }
    function beginSupplier(orderId: string, actor = owner.id) {
      return service.rpc('begin_supplier_fulfilment', { p_order_id: orderId, p_actor_id: actor });
    }
    function supplierReceipt(command: { order_id: string; request_hash: string }) {
      return {
        schemaVersion: 1,
        orderId: command.order_id,
        requestHash: command.request_hash,
        status: 'accepted',
        supplierReference: 'BOREAL-' + command.order_id,
      };
    }
    function finishSupplier(
      command: { order_id: string; request_hash: string },
      receipt = supplierReceipt(command),
      actor = owner.id,
    ) {
      return service.rpc('finish_supplier_fulfilment', {
        p_order_id: command.order_id,
        p_actor_id: actor,
        p_receipt: receipt,
      });
    }
    async function publish(enabled = true) {
      const current = ok(await service.from('published_offers').select('revision').eq('variant_id', variant));
      return ok(
        await service.rpc('publish_offer', {
          p_org_id: org,
          p_actor_id: owner.id,
          p_variant_id: variant,
          p_expected_revision: current[0]?.revision ?? 0,
          p_enabled: enabled,
          p_image_ids: [],
        }),
      );
    }
    async function personal() {
      const scene = createDemoScene();
      scene.objects = [];
      scene.groups = [];
      scene.id = randomUUID();
      scene.organisationId = 'consumer:' + consumer.id;
      const row = ok(
        await service.rpc('create_consumer_project', {
          p_actor_id: consumer.id,
          p_name: 'Private owned room',
          p_currency: 'EUR',
          p_budget_minor: 100000,
          p_scene: scene,
        }),
      );
      consumerIds.push(row.id);
      return row as { id: string; data: Scene; version: number };
    }
    function commit(row: { id: string; data: Scene }, scene: Scene, actor = consumer.id, version = 0) {
      return service.rpc('commit_consumer_scene', {
        p_project_id: row.id,
        p_actor_id: actor,
        p_expected_version: version,
        p_scene: scene,
        p_history: [row.data],
        p_future: [],
      });
    }
    function enqueue(
      projectId: string | null,
      actor = owner.id,
      kind = 'ai_design',
      key = randomUUID(),
      payload: unknown = { brief: 'Test' },
    ) {
      return service.rpc('enqueue_tenant_job', {
        p_org_id: org,
        p_project_id: projectId,
        p_actor_id: actor,
        p_kind: kind,
        p_payload: payload,
        p_dedupe_key: key,
        p_request_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      });
    }
    function finish(job: { id: string; lease_token: string }, error: string | null = null, retry = false) {
      return service.rpc('finish_tenant_job', {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_result: error ? null : { safe: true },
        p_error_code: error,
        p_retryable: retry,
      });
    }
    beforeAll(async () => {
      const status = await localTestPreflight();
      service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      anonymous = createClient(status.API_URL, status.ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      db = new Client({ connectionString: status.DB_URL });
      await db.connect();
      const pending = ok(await service.from('tenant_jobs').select('id').in('status', ['queued', 'running']));
      if (pending.length)
        throw new Error('Finish pending local application jobs before running lease integration tests.');
      async function actor() {
        const email = 'platform-' + randomUUID() + '@roomsell.test',
          password = randomBytes(24).toString('base64url'),
          user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user!;
        users.push(user.id);
        const client = createClient(status.API_URL, status.ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        ok(await client.auth.signInWithPassword({ email, password }));
        return { id: user.id, client };
      }
      [owner, foreign, buyer, other, consumer] = await Promise.all([
        actor(),
        actor(),
        actor(),
        actor(),
        actor(),
      ]);
      org = ok(
        await owner.client.rpc('create_organisation', {
          p_name: 'Platform isolated tenant',
          p_currency: 'EUR',
        }),
      ).id;
      foreignOrg = ok(
        await foreign.client.rpc('create_organisation', {
          p_name: 'Unrelated platform tenant',
          p_currency: 'EUR',
        }),
      ).id;
      ok(
        await service
          .from('organisation_members')
          .insert([buyer, other].map((a) => ({ organisation_id: org, user_id: a.id, role: 'customer' })))
          .select(),
      );
      const input = {
        sku: 'PLATFORM-A',
        name: 'Platform bedside',
        priceMinor: 10000,
        dimensions: { width: 0.5, depth: 0.5, height: 1 },
        color: '#112233',
        material: 'Oak',
        active: true,
        availability: 'in_stock',
        stockQuantity: 4,
        leadTimeDays: 7,
      };
      product = ok(
        await service.rpc('catalogue_product_write', {
          p_org_id: org,
          p_actor_id: owner.id,
          p_product_id: null,
          p_product: { ...input, category: 'bedside', currency: 'EUR', variants: [input] },
        }),
      );
      variant = ok(await service.from('product_variants').select('id').eq('product_id', product).single()).id;
      ok(
        await service.rpc('set_retailer_pricing_policy', {
          p_org_id: org,
          p_actor_id: owner.id,
          p_expected_revision: 0,
          p_policy: policy,
        }),
      );
    }, 30000);
    beforeEach(async () => {
      if (!org) return;
      await db.query('delete from public.tenant_jobs where organisation_id=$1', [org]);
      await db.query('delete from public.retailer_orders where organisation_id=$1', [org]);
      await db.query('delete from public.inventory_connections where organisation_id=$1', [org]);
      ok(
        await service
          .from('product_variants')
          .update({ stock_quantity: 4, availability: 'in_stock' })
          .eq('id', variant)
          .select(),
      );
    });
    afterAll(async () => {
      if (service && org) {
        if (paths.length) await service.storage.from('room-references').remove(paths);
        await db.query('delete from public.retailer_orders where organisation_id=$1', [org]);
        await db.query('delete from public.marketplace_enquiries where organisation_id=$1', [org]);
        await db.query('delete from public.published_offers where organisation_id=$1', [org]);
        if (consumerIds.length)
          await db.query('delete from public.consumer_projects where id=any($1::uuid[])', [consumerIds]);
        for (const id of [org, foreignOrg].filter(Boolean))
          ok(await service.from('organisations').delete().eq('id', id).select());
      }
      if (service) for (const id of users) await service.auth.admin.deleteUser(id);
      if (db) await db.end();
    });
    it('keeps room image metadata and bytes private to assigned projects', async () => {
      const p = await project(),
        id = randomUUID(),
        path = org + '/' + p.project.id + '/' + id,
        bytes = await readFile('fixtures/boreal-living/images/bedside.png');
      paths.push(path);
      ok(await service.storage.from('room-references').upload(path, bytes, { contentType: 'image/png' }));
      ok(
        await service.rpc('room_reference_write', {
          p_project_id: p.project.id,
          p_actor_id: buyer.id,
          p_reference_id: id,
          p_asset: { path, name: 'Private test room.png', mimeType: 'image/png', sizeBytes: bytes.length },
        }),
      );
      expect(ok(await buyer.client.from('room_references').select('id').eq('id', id))).toHaveLength(1);
      expect(ok(await foreign.client.from('room_references').select('id').eq('id', id))).toHaveLength(0);
      expect((await foreign.client.storage.from('room-references').download(path)).error).toBeTruthy();
      expect((await anonymous.storage.from('room-references').download(path)).error).toBeTruthy();
      expect((await buyer.client.storage.from('room-references').download(path)).error).toBeNull();
    });
    it('rejects a forged staged reference path and direct metadata writes', async () => {
      const p = await project();
      expect(
        (
          await service.rpc('room_reference_write', {
            p_project_id: p.project.id,
            p_actor_id: owner.id,
            p_reference_id: randomUUID(),
            p_asset: { path: 'another/project', name: 'x', mimeType: 'image/png', sizeBytes: 1 },
          })
        ).error?.code,
      ).toBe('23514');
      expect((await buyer.client.from('room_references').insert({})).error?.code).toBe('42501');
    });
    async function photoReference(projectId: string) {
      const id = randomUUID(),
        path = org + '/' + projectId + '/' + id,
        bytes = await readFile('fixtures/boreal-living/photo-demo/room.png');
      paths.push(path);
      ok(await service.storage.from('room-references').upload(path, bytes, { contentType: 'image/png' }));
      return ok(
        await service.rpc('room_reference_write', {
          p_project_id: projectId,
          p_actor_id: owner.id,
          p_reference_id: id,
          p_asset: { path, name: 'Synthetic photo', mimeType: 'image/png', sizeBytes: bytes.length },
        }),
      );
    }
    function photoWrite(
      projectId: string,
      referenceId: string,
      revision = 0,
      body: Record<string, unknown> = {},
      actor = owner.id,
    ) {
      return service.rpc('write_photo_workspace', {
        p_project_id: projectId,
        p_reference_id: referenceId,
        p_actor_id: actor,
        p_expected_revision: revision,
        p_body: { calibration: null, regions: [], backgroundReferenceId: null, ...body },
      });
    }
    it('scopes photograph setup to its project and tenant and checks revisions', async () => {
      const p = await project(),
        otherProject = await project(),
        ref = await photoReference(p.project.id);
      expect(ok(await photoWrite(p.project.id, ref.id)).revision).toBe(1);
      expect((await photoWrite(p.project.id, ref.id)).error?.code).toBe('40001');
      expect((await photoWrite(otherProject.project.id, ref.id)).error?.code).toBe('P0002');
      expect((await photoWrite(p.project.id, ref.id, 1, {}, foreign.id)).error?.code).toBe('42501');
      expect(
        ok(await buyer.client.from('photo_workspaces').select('reference_id').eq('reference_id', ref.id)),
      ).toHaveLength(1);
      expect(
        ok(await foreign.client.from('photo_workspaces').select('reference_id').eq('reference_id', ref.id)),
      ).toHaveLength(0);
      expect(
        (await buyer.client.from('photo_workspaces').update({ revision: 99 }).eq('reference_id', ref.id))
          .error?.code,
      ).toBe('42501');
      expect(
        (
          await service
            .from('photo_workspaces')
            .insert({ reference_id: ref.id, project_id: p.project.id, organisation_id: org })
        ).error?.code,
      ).toBe('42501');
    });
    it('requires current confirmed room dimensions for photograph calibration', async () => {
      const p = await project(),
        ref = await photoReference(p.project.id),
        calibration = JSON.parse(
          await readFile('fixtures/boreal-living/photo-demo/calibration.json', 'utf8'),
        );
      await db.query(
        "update public.scenes set data=jsonb_set(data,'{room,measurementsConfirmed}','true') where project_id=$1",
        [p.project.id],
      );
      calibration.roomWidth = p.scene.data.room.width;
      calibration.roomDepth = p.scene.data.room.depth;
      expect(ok(await photoWrite(p.project.id, ref.id, 0, { calibration })).revision).toBe(1);
      expect(
        (await photoWrite(p.project.id, ref.id, 1, { calibration: { ...calibration, roomWidth: 30 } })).error
          ?.code,
      ).toBe('40001');
    });
    it('applies only a completed cleanup for the exact source revision, preserving the original', async () => {
      const p = await project(),
        ref = await photoReference(p.project.id),
        output = await photoReference(p.project.id);
      ok(await photoWrite(p.project.id, ref.id));
      expect(
        (await photoWrite(p.project.id, ref.id, 1, { backgroundReferenceId: output.id })).error?.code,
      ).toBe('40001');
      const job = ok(
        await enqueue(p.project.id, owner.id, 'photo_cleanup', randomUUID(), {
          referenceId: ref.id,
          expectedRevision: 1,
        }),
      );
      const claim = ok(await service.rpc('claim_tenant_job'));
      expect(claim.id).toBe(job.id);
      ok(
        await service.rpc('finish_tenant_job', {
          p_job_id: job.id,
          p_lease_token: claim.lease_token,
          p_result: { referenceId: ref.id, workspaceRevision: 1, generatedReferenceId: output.id },
          p_error_code: null,
          p_retryable: false,
        }),
      );
      expect(
        ok(await photoWrite(p.project.id, ref.id, 1, { backgroundReferenceId: output.id })).revision,
      ).toBe(2);
      expect(ok(await buyer.client.from('room_references').select('id').eq('id', ref.id))).toHaveLength(1);
      ok(
        await service.rpc('room_reference_write', {
          p_project_id: p.project.id,
          p_actor_id: owner.id,
          p_reference_id: output.id,
          p_asset: null,
        }),
      );
      expect(
        ok(
          await buyer.client
            .from('photo_workspaces')
            .select('background_reference_id')
            .eq('reference_id', ref.id)
            .single(),
        ).background_reference_id,
      ).toBeNull();
      expect(
        (await photoWrite(p.project.id, ref.id, 2, { backgroundReferenceId: output.id })).error?.code,
      ).toBe('40001');
    });
    it('cancels photo jobs after edit permission is revoked and shares the AI hourly quota', async () => {
      const p = await project();
      ok(await enqueue(p.project.id, buyer.id, 'photo_analysis'));
      ok(
        await service
          .from('project_access')
          .delete()
          .eq('project_id', p.project.id)
          .eq('user_id', buyer.id)
          .select(),
      );
      const claim = await service.rpc('claim_tenant_job');
      expect(claim.error).toBeNull();
      expect(claim.data).toBeNull();
      expect(
        ok(await service.from('tenant_jobs').select('status').eq('actor_id', buyer.id).single()).status,
      ).toBe('cancelled');
      for (let i = 0; i < 20; i++)
        ok(await enqueue(p.project.id, owner.id, i % 2 ? 'photo_cleanup' : 'ai_design'));
      expect((await enqueue(p.project.id, owner.id, 'photo_analysis')).error?.code).toBe('23514');
    });
    it('deduplicates queued jobs but rejects payload reuse and foreign actors', async () => {
      const p = await project(),
        key = randomUUID(),
        a = ok(await enqueue(p.project.id, owner.id, 'ai_design', key));
      expect(ok(await enqueue(p.project.id, owner.id, 'ai_design', key)).id).toBe(a.id);
      expect(
        (await enqueue(p.project.id, owner.id, 'ai_design', key, { brief: 'Changed' })).error?.code,
      ).toBe('40001');
      expect((await enqueue(p.project.id, foreign.id)).error?.code).toBe('42501');
      expect(ok(await foreign.client.from('tenant_jobs').select('id').eq('id', a.id))).toEqual([]);
    });
    it('claims a queued job once across simultaneous workers and completes by lease', async () => {
      const p = await project(),
        job = ok(await enqueue(p.project.id));
      const claimed = await Promise.all([service.rpc('claim_tenant_job'), service.rpc('claim_tenant_job')]);
      expect(claimed.every((r) => !r.error)).toBe(true);
      const leases = claimed.map((r) => r.data).filter(Boolean);
      expect(leases).toHaveLength(1);
      expect(leases[0].id).toBe(job.id);
      expect(ok(await finish(leases[0])).status).toBe('completed');
      expect((await finish(leases[0])).error?.code).toBe('40001');
    });
    it('reclaims expired leases and rejects the previous worker token', async () => {
      const p = await project();
      await enqueue(p.project.id);
      const old = ok(await service.rpc('claim_tenant_job'));
      await db.query("update public.tenant_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [
        old.id,
      ]);
      const next = ok(await service.rpc('claim_tenant_job'));
      expect(next.attempts).toBe(2);
      expect(next.lease_token).not.toBe(old.lease_token);
      expect((await finish(old)).error?.code).toBe('40001');
      expect(ok(await finish(next)).status).toBe('completed');
    });
    it('retries transient failure at most three times', async () => {
      const p = await project();
      await enqueue(p.project.id);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const job = ok(await service.rpc('claim_tenant_job'));
        expect(job.attempts).toBe(attempt);
        expect(ok(await finish(job, 'provider_unavailable', true)).status).toBe(
          attempt === 3 ? 'failed' : 'queued',
        );
        await db.query("update public.tenant_jobs set available_at=now()-interval '1 second' where id=$1", [
          job.id,
        ]);
      }
    });
    it('cancels completion after project permission is revoked', async () => {
      const p = await project();
      await enqueue(p.project.id, buyer.id);
      const job = ok(await service.rpc('claim_tenant_job'));
      ok(
        await service
          .from('project_access')
          .delete()
          .eq('project_id', p.project.id)
          .eq('user_id', buyer.id)
          .select(),
      );
      const ended = ok(await finish(job));
      expect(ended.status).toBe('cancelled');
      expect(ended.result).toBeNull();
    });
    it('prevents ordinary users and workers from writing queue rows directly', async () => {
      expect((await owner.client.rpc('claim_tenant_job')).error?.code).toBe('42501');
      expect(
        (await service.from('tenant_jobs').update({ status: 'completed' }).eq('organisation_id', org)).error
          ?.code,
      ).toBe('42501');
    });
    it('reserves idempotently and isolates order ownership and immutable prices', async () => {
      const p = await project(),
        q = await quote(p.project.id),
        key = randomUUID(),
        order = ok(await reserve(p.project.id, q.id, buyer.id, key));
      expect(ok(await reserve(p.project.id, q.id, buyer.id, key)).id).toBe(order.id);
      expect(order.snapshot).toEqual(q.snapshot);
      expect(ok(await other.client.from('retailer_orders').select('id').eq('id', order.id))).toEqual([]);
      expect((await transition(order.id, 'reserved', 'cancel', other.id)).error?.code).toBe('42501');
      expect(ok(await owner.client.from('retailer_orders').select('id').eq('id', order.id))).toHaveLength(1);
      await expect(
        db.query("update public.retailer_orders set snapshot='{}'::jsonb where id=$1", [order.id]),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('serializes reservations so two buyers cannot oversell one item', async () => {
      ok(await service.from('product_variants').update({ stock_quantity: 1 }).eq('id', variant).select());
      const p1 = await project(),
        p2 = await project(),
        q1 = await quote(p1.project.id),
        q2 = await quote(p2.project.id);
      const results = await Promise.all([reserve(p1.project.id, q1.id), reserve(p2.project.id, q2.id)]);
      expect(results.filter((r) => !r.error)).toHaveLength(1);
      expect(results.filter((r) => r.error?.code === '40001')).toHaveLength(1);
      expect(ok(await service.rpc('available_variant_stock', { p_variant_id: variant }))).toBe(0);
    });
    it('releases an expired reservation and rejects stale confirmation', async () => {
      const p = await project(),
        q = await quote(p.project.id),
        order = ok(await reserve(p.project.id, q.id));
      await db.query("update public.retailer_orders set expires_at=now()-interval '1 second' where id=$1", [
        order.id,
      ]);
      expect(ok(await service.rpc('expire_order_reservations', { p_org_id: org }))).toBe(1);
      expect((await transition(order.id, 'reserved', 'confirm')).error?.code).toBe('40001');
      expect(ok(await service.rpc('available_variant_stock', { p_variant_id: variant }))).toBe(4);
    });
    it('confirms without charging and fulfils once with retailer authority', async () => {
      const p = await project(),
        q = await quote(p.project.id),
        order = ok(await reserve(p.project.id, q.id));
      expect(ok(await transition(order.id, 'reserved', 'confirm')).status).toBe('confirmed');
      expect((await transition(order.id, 'confirmed', 'fulfil')).error?.code).toBe('42501');
      expect(ok(await transition(order.id, 'confirmed', 'fulfil', owner.id)).status).toBe('fulfilled');
      expect(
        ok(await service.from('product_variants').select('stock_quantity').eq('id', variant).single())
          .stock_quantity,
      ).toBe(3);
      expect((await transition(order.id, 'confirmed', 'fulfil', owner.id)).error?.code).toBe('40001');
    });
    it('blocks fulfilment if reduced external stock cannot cover all confirmed orders', async () => {
      const a = await project(),
        b = await project(),
        qa = await quote(a.project.id),
        qb = await quote(b.project.id),
        oa = ok(await reserve(a.project.id, qa.id)),
        ob = ok(await reserve(b.project.id, qb.id));
      ok(await transition(oa.id, 'reserved', 'confirm'));
      ok(await transition(ob.id, 'reserved', 'confirm'));
      ok(await service.from('product_variants').update({ stock_quantity: 1 }).eq('id', variant).select());
      expect((await transition(oa.id, 'confirmed', 'fulfil', owner.id)).error?.code).toBe('40001');
      expect(
        ok(await service.from('product_variants').select('stock_quantity').eq('id', variant).single())
          .stock_quantity,
      ).toBe(1);
    });
    it('refuses unacknowledged fulfilment for real snapshot-only provider mappings', async () => {
      const p = await project(),
        q = await quote(p.project.id),
        order = ok(await reserve(p.project.id, q.id));
      ok(await transition(order.id, 'reserved', 'confirm'));
      const connection = randomUUID();
      await db.query(
        "insert into public.inventory_connections(id,organisation_id,name,provider,endpoint) values($1,$2,'Snapshot only','custom_rest','https://inventory.example.test/snapshot')",
        [connection, org],
      );
      try {
        await db.query(
          "insert into public.inventory_mappings(organisation_id,connection_id,external_product_id,external_variant_id,product_id,variant_id) values($1,$2,'external','external-v',$3,$4)",
          [org, connection, product, variant],
        );
        expect((await transition(order.id, 'confirmed', 'fulfil', owner.id)).error?.code).toBe('23514');
        expect(
          ok(await service.from('product_variants').select('stock_quantity').eq('id', variant).single())
            .stock_quantity,
        ).toBe(4);
      } finally {
        await db.query('delete from public.inventory_connections where id=$1', [connection]);
      }
    });
    it('pins one supplier request across concurrent starts and denies buyers and foreign actors', async () => {
      const { order } = await supplierOrder();
      for (const actor of [buyer.id, foreign.id])
        expect((await beginSupplier(order.id, actor)).error?.code).toBe('42501');
      expect(
        (await owner.client.rpc('begin_supplier_fulfilment', { p_order_id: order.id, p_actor_id: owner.id }))
          .error?.code,
      ).toBe('42501');
      const [a, b] = await Promise.all([beginSupplier(order.id), beginSupplier(order.id)]);
      expect(ok(a)).toEqual(ok(b));
      expect(ok(a).request.items).toEqual([
        { externalProductId: 'external', externalVariantId: 'external-v', sku: 'PLATFORM-A', quantity: 1 },
      ]);
      expect(ok(await foreign.client.from('supplier_fulfilments').select('*'))).toEqual([]);
      expect(
        (await service.from('supplier_fulfilments').update({ receipt: {} }).eq('order_id', order.id)).error
          ?.code,
      ).toBe('42501');
    });
    it('keeps cancellation, supplier configuration and stock fenced after a lost acknowledgement', async () => {
      const { order, connection } = await supplierOrder(),
        command = ok(await beginSupplier(order.id));
      expect((await transition(order.id, 'confirmed', 'cancel', owner.id)).error?.code).toBe('40001');
      expect((await transition(order.id, 'confirmed', 'fulfil', owner.id)).error?.code).toBe('23514');
      expect(
        (await service.from('inventory_connections').update({ enabled: false }).eq('id', connection)).error
          ?.code,
      ).toBe('40001');
      expect(
        (await service.from('inventory_mappings').delete().eq('connection_id', connection)).error?.code,
      ).toBe('40001');
      expect(
        (await service.from('product_variants').update({ stock_quantity: 1 }).eq('id', variant)).error?.code,
      ).toBe('40001');
      expect(ok(await beginSupplier(order.id)).request).toEqual(command.request);
      expect(ok(await finishSupplier(command)).status).toBe('fulfilled');
    });
    it('rejects a mismatched acknowledgement and fulfils exactly once across concurrent retries', async () => {
      const { order } = await supplierOrder(),
        command = ok(await beginSupplier(order.id));
      expect(
        (await finishSupplier(command, { ...supplierReceipt(command), requestHash: 'b'.repeat(64) })).error
          ?.code,
      ).toBe('23514');
      expect(
        ok(await service.from('retailer_orders').select('status').eq('id', order.id).single()).status,
      ).toBe('confirmed');
      const results = await Promise.all([finishSupplier(command), finishSupplier(command)]);
      expect(results.map((r) => ok(r).status)).toEqual(['fulfilled', 'fulfilled']);
      expect(
        ok(await service.from('product_variants').select('stock_quantity').eq('id', variant).single())
          .stock_quantity,
      ).toBe(3);
      expect(
        (await finishSupplier(command, { ...supplierReceipt(command), supplierReference: 'changed' })).error
          ?.code,
      ).toBe('40001');
      expect(ok(await beginSupplier(order.id)).receipt).toEqual(supplierReceipt(command));
    });
    it('rechecks current staff permission before completing a supplier acknowledgement', async () => {
      const { order } = await supplierOrder();
      ok(
        await service
          .from('organisation_members')
          .update({ role: 'salesperson' })
          .eq('organisation_id', org)
          .eq('user_id', other.id)
          .select(),
      );
      const command = ok(await beginSupplier(order.id, other.id));
      ok(
        await service
          .from('organisation_members')
          .update({ role: 'customer' })
          .eq('organisation_id', org)
          .eq('user_id', other.id)
          .select(),
      );
      expect((await finishSupplier(command, supplierReceipt(command), other.id)).error?.code).toBe('42501');
      expect(ok(await finishSupplier(command)).status).toBe('fulfilled');
    });
    it('records a definitive supplier rejection without decrementing stock and permits cancellation', async () => {
      const { order } = await supplierOrder(),
        command = ok(await beginSupplier(order.id));
      const rejected = { ...supplierReceipt(command), status: 'rejected' };
      expect(ok(await finishSupplier(command, rejected)).status).toBe('confirmed');
      expect((await transition(order.id, 'confirmed', 'fulfil', owner.id)).error?.code).toBe('23514');
      expect(
        ok(await service.from('product_variants').select('stock_quantity').eq('id', variant).single())
          .stock_quantity,
      ).toBe(4);
      expect(ok(await transition(order.id, 'confirmed', 'cancel', buyer.id)).status).toBe('cancelled');
    });
    it('defers another order using the same supplier until the uncertain command is resolved', async () => {
      const { order } = await supplierOrder(),
        pending = ok(await beginSupplier(order.id));
      const secondProject = await project(),
        secondQuote = await quote(secondProject.project.id),
        secondOrder = ok(await reserve(secondProject.project.id, secondQuote.id));
      ok(await transition(secondOrder.id, 'reserved', 'confirm'));
      expect((await beginSupplier(secondOrder.id)).error?.code).toBe('40001');
      ok(await finishSupplier(pending));
      const next = ok(await beginSupplier(secondOrder.id));
      expect(ok(await finishSupplier(next)).status).toBe('fulfilled');
      expect(
        ok(await service.from('product_variants').select('stock_quantity').eq('id', variant).single())
          .stock_quantity,
      ).toBe(2);
    });
    it('does not send a supplier order when stock no longer covers confirmed orders', async () => {
      const { order } = await supplierOrder();
      ok(
        await service
          .from('product_variants')
          .update({ stock_quantity: 0, availability: 'out_of_stock' })
          .eq('id', variant)
          .select(),
      );
      expect((await beginSupplier(order.id)).error?.code).toBe('40001');
      expect(
        ok(await service.from('supplier_fulfilments').select('order_id').eq('order_id', order.id)),
      ).toEqual([]);
    });
    it('requires explicit order access and blocks cross-tenant order actors', async () => {
      const p = await project(),
        q = await quote(p.project.id);
      ok(
        await owner.client.rpc('grant_project_access', {
          p_org_id: org,
          p_project_id: p.project.id,
          p_user_id: buyer.id,
          p_can_edit: true,
          p_can_order: false,
        }),
      );
      expect((await reserve(p.project.id, q.id)).error?.code).toBe('42501');
      expect((await reserve(p.project.id, q.id, foreign.id)).error?.code).toBe('42501');
    });
    it('publishes only with explicit admin consent, validated images and revision CAS', async () => {
      const offer = await publish();
      expect(offer.enabled).toBe(true);
      expect(
        (
          await service.rpc('publish_offer', {
            p_org_id: org,
            p_actor_id: buyer.id,
            p_variant_id: variant,
            p_expected_revision: offer.revision,
            p_enabled: false,
            p_image_ids: [],
          })
        ).error?.code,
      ).toBe('42501');
      expect(
        (
          await service.rpc('publish_offer', {
            p_org_id: org,
            p_actor_id: owner.id,
            p_variant_id: variant,
            p_expected_revision: offer.revision,
            p_enabled: true,
            p_image_ids: [randomUUID()],
          })
        ).error?.code,
      ).toBe('23514');
      expect(
        (
          await service.rpc('publish_offer', {
            p_org_id: org,
            p_actor_id: owner.id,
            p_variant_id: variant,
            p_expected_revision: 0,
            p_enabled: true,
            p_image_ids: [],
          })
        ).error?.code,
      ).toBe('40001');
      expect((await anonymous.from('published_offers').select('*')).error?.code).toBe('42501');
    });
    it('keeps consumer projects private even from retailer administrators', async () => {
      const p = await personal();
      expect(ok(await consumer.client.from('consumer_projects').select('id').eq('id', p.id))).toHaveLength(1);
      for (const actor of [owner, foreign, other])
        expect(ok(await actor.client.from('consumer_projects').select('id').eq('id', p.id))).toEqual([]);
      expect((await commit(p, { ...p.data, version: 1 }, owner.id)).error?.code).toBe('P0002');
      expect(
        (await consumer.client.from('consumer_projects').update({ owner_id: owner.id }).eq('id', p.id)).error
          ?.code,
      ).toBe('42501');
    });
    it('checks consumer scene versions and current published SKU metadata', async () => {
      await publish();
      const p = await personal(),
        retailer = await project(),
        object = structuredClone(retailer.scene.data.objects[0]),
        scene = { ...p.data, version: 1, objects: [object] };
      expect(ok(await commit(p, scene)).version).toBe(1);
      expect((await commit(p, scene)).error?.code).toBe('40001');
      const fresh = await personal();
      expect(
        (await commit(fresh, { ...fresh.data, version: 1, objects: [{ ...object, sku: 'INVENTED' }] })).error
          ?.code,
      ).toBe('40001');
    });
    it('rejects aggregate consumer quantities that exceed current available stock', async () => {
      await publish();
      ok(await service.from('product_variants').update({ stock_quantity: 1 }).eq('id', variant).select());
      const p = await personal(),
        retailer = await project(),
        object = retailer.scene.data.objects[0];
      expect(
        (
          await commit(p, {
            ...p.data,
            version: 1,
            objects: [object, { ...object, id: randomUUID(), transform: { x: 4, y: 0, z: 2, rotation: 0 } }],
          })
        ).error?.code,
      ).toBe('40001');
      expect(
        ok(await consumer.client.from('consumer_projects').select('version').eq('id', p.id).single()).version,
      ).toBe(0);
    });
    it('rejects newly added unpublished variants without corrupting the personal scene', async () => {
      await publish(false);
      const p = await personal(),
        retailer = await project();
      expect(
        (await commit(p, { ...p.data, version: 1, objects: retailer.scene.data.objects })).error?.code,
      ).toBe('40001');
      expect(
        ok(await consumer.client.from('consumer_projects').select('version').eq('id', p.id).single()).version,
      ).toBe(0);
    });
    it('shares only an explicitly selected retailer subset and preserves private ownership', async () => {
      await publish();
      const p = await personal(),
        retailer = await project(),
        scene = { ...p.data, version: 1, objects: retailer.scene.data.objects };
      ok(await commit(p, scene));
      const args = {
        p_consumer_project_id: p.id,
        p_actor_id: consumer.id,
        p_org_id: org,
        p_expected_version: 1,
        p_scene: scene,
      };
      const enquiry = ok(await service.rpc('marketplace_enquiry', args));
      expect(ok(await service.rpc('marketplace_enquiry', args)).id).toBe(enquiry.id);
      expect((await service.rpc('marketplace_enquiry', { ...args, p_org_id: foreignOrg })).error?.code).toBe(
        '40001',
      );
      expect(ok(await owner.client.from('consumer_projects').select('id').eq('id', p.id))).toEqual([]);
      expect(
        ok(await foreign.client.from('projects').select('id').eq('id', enquiry.retailer_project_id)),
      ).toEqual([]);
      expect(
        ok(
          await consumer.client
            .from('project_access')
            .select('can_edit,can_order')
            .eq('project_id', enquiry.retailer_project_id),
        ).map((a) => [a.can_edit, a.can_order]),
      ).toEqual([[false, true]]);
    });
  },
);
