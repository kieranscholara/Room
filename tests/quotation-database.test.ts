import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createDemoScene, type Scene } from '@roomsell/scene-core';
import { priceQuotation, type PricingPolicy } from '@roomsell/pricing';
import { quotationSourceSchema } from '../apps/web/lib/quotation-schemas';
import { localTestPreflight } from '../scripts/test-preflight.mjs';

const enabled = process.env.ROOMSELL_RUN_DATABASE_TESTS === '1';
interface Identity {
  id: string;
  client: SupabaseClient;
}
function success<T extends { data: unknown; error: { message: string } | null }>(
  result: T,
): NonNullable<T['data']> {
  if (result.error || result.data === null)
    throw new Error(result.error?.message || 'Missing database result');
  return result.data as NonNullable<T['data']>;
}
const policy: PricingPolicy = {
  version: 1,
  currency: 'EUR',
  taxMode: 'exclusive',
  taxRateBps: 2000,
  rounding: 'invoice',
  discountBps: 1000,
  deliveryMinor: 123,
  installationMinor: 47,
  feesTaxable: true,
};

describe.skipIf(!enabled)('real quotation pricing, immutability and tenant security', () => {
  let service: SupabaseClient;
  let anonymous: SupabaseClient;
  let db: Client;
  let dbUrl: string;
  let owner: Identity;
  let foreignOwner: Identity;
  let sales: Identity;
  let customer: Identity;
  let orgId: string;
  let foreignOrgId: string;
  let productId: string;
  let variantId: string;
  let policyRevision = 0;
  const users: string[] = [];
  const orgs: string[] = [];

  async function configure(next: PricingPolicy = policy) {
    const result = success(
      await service.rpc('set_retailer_pricing_policy', {
        p_org_id: orgId,
        p_actor_id: owner.id,
        p_expected_revision: policyRevision,
        p_policy: next,
      }),
    );
    policyRevision = result.revision;
    return result;
  }
  async function createProject() {
    const scene = createDemoScene();
    scene.groups = [];
    scene.objects = [1, 2].map((index) => ({
      id: randomUUID(),
      variantId,
      sku: 'QUOTE-VARIANT',
      name: 'Measured quotation bedside',
      category: 'bedside',
      color: '#112233',
      solid: true,
      dimensions: { width: 0.5, depth: 0.5, height: 1 },
      transform: { x: index * 2, y: 0, z: 2, rotation: 0 },
      locks: { position: false, rotation: false, product: false },
    })) as Scene['objects'];
    scene.room.measurementsConfirmed = true;
    return success(
      await service.rpc('create_project', {
        p_org_id: orgId,
        p_actor_id: owner.id,
        p_customer_id: null,
        p_name: `Quotation ${randomUUID()}`,
        p_budget_minor: 30000,
        p_currency: 'EUR',
        p_style: '',
        p_room_type: 'bedroom',
        p_scene: scene,
      }),
    ) as { project: { id: string }; scene: { id: string; data: Scene; version: number } };
  }
  async function source(projectId: string, actor = owner.id, version = 0) {
    return quotationSourceSchema.parse(
      success(
        await service.rpc('quotation_source', {
          p_project_id: projectId,
          p_actor_id: actor,
          p_expected_scene_version: version,
          p_expected_policy_revision: policyRevision,
        }),
      ),
    );
  }
  function issueArguments(
    projectId: string,
    value: ReturnType<typeof quotationSourceSchema.parse>,
    actor = owner.id,
    key = randomUUID(),
  ) {
    return {
      p_project_id: projectId,
      p_actor_id: actor,
      p_expected_scene_version: value.sceneVersion,
      p_expected_policy_revision: value.policyRevision,
      p_idempotency_key: key,
      p_request_hash: createHash('sha256')
        .update(
          JSON.stringify({
            projectId,
            sceneVersion: value.sceneVersion,
            policyRevision: value.policyRevision,
            source: value,
          }),
        )
        .digest('hex'),
      p_source: value,
      p_calculation: priceQuotation({
        policy: value.policy,
        items: value.items.map(({ variantId, sku, name, quantity, unitPriceMinor, currency }) => ({
          variantId,
          sku,
          name,
          quantity,
          unitPriceMinor,
          currency,
        })),
      }),
    };
  }
  async function count(projectId: string) {
    return success(await service.from('quotations').select('id').eq('project_id', projectId)).length;
  }
  beforeAll(async () => {
    const status = await localTestPreflight();
    service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anonymous = createClient(status.API_URL, status.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    dbUrl = status.DB_URL!;
    db = new Client({ connectionString: dbUrl });
    await db.connect();
    async function identity() {
      const email = `quote-${randomUUID()}@roomsell.test`;
      const password = randomBytes(24).toString('base64url');
      const user = success(
        await service.auth.admin.createUser({ email, password, email_confirm: true }),
      ).user!;
      const client = createClient(status.API_URL, status.ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      success(await client.auth.signInWithPassword({ email, password }));
      users.push(user.id);
      return { id: user.id, client };
    }
    [owner, foreignOwner, sales, customer] = await Promise.all([
      identity(),
      identity(),
      identity(),
      identity(),
    ]);
    orgId = success(
      await owner.client.rpc('create_organisation', { p_name: 'Quotation retailer', p_currency: 'EUR' }),
    ).id;
    foreignOrgId = success(
      await foreignOwner.client.rpc('create_organisation', { p_name: 'Foreign retailer', p_currency: 'EUR' }),
    ).id;
    orgs.push(orgId, foreignOrgId);
    success(
      await service
        .from('organisation_members')
        .insert([
          { organisation_id: orgId, user_id: sales.id, role: 'salesperson' },
          { organisation_id: orgId, user_id: customer.id, role: 'customer' },
        ])
        .select(),
    );
    const inventory = {
      sku: 'QUOTE-VARIANT',
      name: 'Measured quotation bedside',
      priceMinor: 12345,
      dimensions: { width: 0.5, depth: 0.5, height: 1 },
      color: '#112233',
      material: 'Oak',
      active: true,
      availability: 'in_stock',
      stockQuantity: 3,
      leadTimeDays: 7,
    };
    productId = success(
      await service.rpc('catalogue_product_write', {
        p_org_id: orgId,
        p_actor_id: owner.id,
        p_product_id: null,
        p_product: { ...inventory, category: 'bedside', currency: 'EUR', variants: [{ ...inventory }] },
      }),
    );
    variantId = success(
      await service.from('product_variants').select('id').eq('product_id', productId).single(),
    ).id;
    await configure();
  }, 30000);
  afterAll(async () => {
    if (db) await db.end();
    if (service) {
      for (const id of orgs) await service.from('organisations').delete().eq('id', id);
      for (const id of users) await service.auth.admin.deleteUser(id);
    }
  });

  it('requires explicit policy, administrator authority and revision CAS; policy history is immutable', async () => {
    const unconfigured = success(
      await service.rpc('create_project', {
        p_org_id: foreignOrgId,
        p_actor_id: foreignOwner.id,
        p_customer_id: null,
        p_name: 'Unconfigured quote project',
        p_budget_minor: 10000,
        p_currency: 'EUR',
        p_style: '',
        p_room_type: 'bedroom',
        p_scene: createDemoScene(),
      }),
    );
    expect(
      (
        await service.rpc('quotation_source', {
          p_project_id: unconfigured.project.id,
          p_actor_id: foreignOwner.id,
          p_expected_scene_version: 0,
          p_expected_policy_revision: 1,
        })
      ).error?.message,
    ).toContain('Configure the retailer pricing policy');
    const denied = await service.rpc('set_retailer_pricing_policy', {
      p_org_id: orgId,
      p_actor_id: sales.id,
      p_expected_revision: policyRevision,
      p_policy: policy,
    });
    expect(denied.error?.code).toBe('42501');
    const stale = await service.rpc('set_retailer_pricing_policy', {
      p_org_id: orgId,
      p_actor_id: owner.id,
      p_expected_revision: policyRevision - 1,
      p_policy: policy,
    });
    expect(stale.error?.code).toBe('40001');
    const wrongCurrency = await service.rpc('set_retailer_pricing_policy', {
      p_org_id: orgId,
      p_actor_id: owner.id,
      p_expected_revision: policyRevision,
      p_policy: { ...policy, currency: 'USD' },
    });
    expect(wrongCurrency.error?.code).toBe('23514');
    const missing = { ...policy } as Partial<PricingPolicy>;
    delete missing.taxMode;
    const invalid = await service.rpc('set_retailer_pricing_policy', {
      p_org_id: orgId,
      p_actor_id: owner.id,
      p_expected_revision: policyRevision,
      p_policy: { ...missing, arbitrary: 'extra field' },
    });
    expect(invalid.error?.code).toBe('23514');
    expect(
      (
        await owner.client
          .from('retailer_pricing_policies')
          .update({ revision: 99 })
          .eq('organisation_id', orgId)
      ).error?.code,
    ).toBe('42501');
    expect(
      (await service.from('retailer_pricing_revisions').update({ policy }).eq('organisation_id', orgId)).error
        ?.code,
    ).toBe('42501');
  });

  it.each(['inclusive', 'exclusive'] as const)(
    'issues exact %s prices in both rounding modes and aggregates repeated variants',
    async (taxMode) => {
      for (const rounding of ['per_line', 'invoice'] as const) {
        await configure({ ...policy, taxMode, rounding });
        const project = await createProject();
        const value = await source(project.project.id);
        expect(value.items).toHaveLength(1);
        expect(value.items[0].quantity).toBe(2);
        expect(value.items[0].objectIds).toHaveLength(2);
        const args = issueArguments(project.project.id, value);
        const quote = success(await service.rpc('issue_quotation', args));
        expect(quote.snapshot.calculation).toEqual(args.p_calculation);
        expect(quote.snapshot.inventoryReserved).toBe(false);
        expect(quote.scene_version).toBe(0);
        expect(quote.policy_revision).toBe(policyRevision);
        expect(await count(project.project.id)).toBe(1);
      }
    },
  );

  it('rejects coherently forged discount/tax maths before persisting any quotation', async () => {
    await configure(policy);
    const project = await createProject();
    const value = await source(project.project.id);
    const args = issueArguments(project.project.id, value);
    const coherent = priceQuotation({
      policy: { ...policy, discountBps: 0, taxRateBps: 0 },
      items: value.items.map(({ variantId, sku, name, quantity, unitPriceMinor, currency }) => ({
        variantId,
        sku,
        name,
        quantity,
        unitPriceMinor,
        currency,
      })),
    });
    const result = await service.rpc('issue_quotation', { ...args, p_calculation: { ...coherent, policy } });
    expect(result.error?.code).toBe('23514');
    expect(await count(project.project.id)).toBe(0);
  });

  it('allocates an invoice tax remainder to a UUID before tied delivery/installation fees', async () => {
    await configure({ ...policy, discountBps: 0, taxRateBps: 2500, deliveryMinor: 2, installationMinor: 2 });
    await db.query('update public.product_variants set price_minor = 1 where id = $1', [variantId]);
    try {
      const project = await createProject();
      const value = await source(project.project.id);
      const args = issueArguments(project.project.id, value);
      expect(args.p_calculation.lines[0].taxMinor).toBe(1);
      expect(args.p_calculation.fees.delivery.taxMinor).toBe(1);
      expect(args.p_calculation.fees.installation.taxMinor).toBe(0);
      expect(success(await service.rpc('issue_quotation', args)).snapshot.calculation).toEqual(
        args.p_calculation,
      );
    } finally {
      await db.query('update public.product_variants set price_minor = 12345 where id = $1', [variantId]);
      await configure(policy);
    }
  });

  it('rejects source changes and price/SKU/quantity forgeries without partial rows', async () => {
    const project = await createProject();
    const value = await source(project.project.id);
    const args = issueArguments(project.project.id, value);
    const changed = {
      ...args.p_calculation,
      lines: args.p_calculation.lines.map((line) => ({ ...line, sku: 'FAKE-SKU' })),
    };
    expect((await service.rpc('issue_quotation', { ...args, p_calculation: changed })).error?.code).toBe(
      '23514',
    );
    await db.query('update public.product_variants set price_minor = price_minor + 1 where id = $1', [
      variantId,
    ]);
    expect((await service.rpc('issue_quotation', args)).error?.code).toBe('40001');
    expect(await count(project.project.id)).toBe(0);
    await db.query('update public.product_variants set price_minor = price_minor - 1 where id = $1', [
      variantId,
    ]);
  });

  it('checks aggregate stock, stale physical dimensions and both expected revisions', async () => {
    const project = await createProject();
    await db.query('update public.product_variants set stock_quantity = 1 where id = $1', [variantId]);
    expect(
      (
        await service.rpc('quotation_source', {
          p_project_id: project.project.id,
          p_actor_id: owner.id,
          p_expected_scene_version: 0,
          p_expected_policy_revision: policyRevision,
        })
      ).error?.code,
    ).toBe('40001');
    await db.query('update public.product_variants set stock_quantity = 3, width_m = 0.6 where id = $1', [
      variantId,
    ]);
    expect(
      (
        await service.rpc('quotation_source', {
          p_project_id: project.project.id,
          p_actor_id: owner.id,
          p_expected_scene_version: 0,
          p_expected_policy_revision: policyRevision,
        })
      ).error?.code,
    ).toBe('40001');
    await db.query('update public.product_variants set width_m = 0.5 where id = $1', [variantId]);
    expect(
      (
        await service.rpc('quotation_source', {
          p_project_id: project.project.id,
          p_actor_id: owner.id,
          p_expected_scene_version: 1,
          p_expected_policy_revision: policyRevision,
        })
      ).error?.code,
    ).toBe('40001');
    expect(
      (
        await service.rpc('quotation_source', {
          p_project_id: project.project.id,
          p_actor_id: owner.id,
          p_expected_scene_version: 0,
          p_expected_policy_revision: policyRevision - 1,
        })
      ).error?.code,
    ).toBe('40001');
  });

  it('makes concurrent retries idempotent and preserves the issued snapshot after catalogue/policy changes', async () => {
    const project = await createProject();
    const value = await source(project.project.id);
    const args = issueArguments(project.project.id, value);
    const [first, second] = await Promise.all([
      service.rpc('issue_quotation', args),
      service.rpc('issue_quotation', args),
    ]);
    const quote = success(first);
    expect(success(second).id).toBe(quote.id);
    expect(await count(project.project.id)).toBe(1);
    await expect(
      db.query('update public.quotations set number = $1 where id = $2', ['Changed', quote.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await db.query('update public.product_variants set price_minor = price_minor + 777 where id = $1', [
      variantId,
    ]);
    await configure({ ...policy, taxRateBps: 1500 });
    expect(success(await service.rpc('issue_quotation', args)).snapshot).toEqual(quote.snapshot);
    expect(
      (await service.rpc('issue_quotation', { ...args, p_request_hash: 'f'.repeat(64) })).error?.code,
    ).toBe('40001');
    expect((await service.rpc('issue_quotation', { ...args, p_actor_id: sales.id })).error?.code).toBe(
      '40001',
    );
    await db.query('update public.product_variants set price_minor = price_minor - 777 where id = $1', [
      variantId,
    ]);
    await configure(policy);
  });

  it('limits customer reads to assigned issued quotes and forbids cross-tenant/direct writes', async () => {
    const assigned = await createProject();
    const unassigned = await createProject();
    const assignedQuote = success(
      await service.rpc(
        'issue_quotation',
        issueArguments(assigned.project.id, await source(assigned.project.id)),
      ),
    );
    const unassignedQuote = success(
      await service.rpc(
        'issue_quotation',
        issueArguments(unassigned.project.id, await source(unassigned.project.id)),
      ),
    );
    success(
      await owner.client.rpc('grant_project_access', {
        p_org_id: orgId,
        p_project_id: assigned.project.id,
        p_user_id: customer.id,
        p_can_edit: false,
      }),
    );
    expect(success(await customer.client.from('quotations').select('id').eq('id', assignedQuote.id))).toEqual(
      [{ id: assignedQuote.id }],
    );
    expect(
      success(await customer.client.from('quotations').select('id').eq('id', unassignedQuote.id)),
    ).toEqual([]);
    expect(
      success(await foreignOwner.client.from('quotations').select('id').eq('organisation_id', orgId)),
    ).toEqual([]);
    expect(
      success(
        await customer.client.from('retailer_pricing_policies').select('*').eq('organisation_id', orgId),
      ),
    ).toEqual([]);
    expect((await anonymous.from('quotations').select('*')).error?.code).toBe('42501');
    expect(
      (await owner.client.from('quotations').insert({ ...assignedQuote, id: randomUUID() })).error?.code,
    ).toBe('42501');
    expect(
      (await service.from('quotations').update({ number: 'changed' }).eq('id', assignedQuote.id)).error?.code,
    ).toBe('42501');
    expect(
      (
        await owner.client.rpc(
          'issue_quotation',
          issueArguments(assigned.project.id, await source(assigned.project.id)),
        )
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await service.rpc('quotation_source', {
          p_project_id: assigned.project.id,
          p_actor_id: customer.id,
          p_expected_scene_version: 0,
          p_expected_policy_revision: policyRevision,
        })
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await service.rpc('quotation_source', {
          p_project_id: assigned.project.id,
          p_actor_id: foreignOwner.id,
          p_expected_scene_version: 0,
          p_expected_policy_revision: policyRevision,
        })
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await owner.client.rpc('revoke_project_access', {
          p_org_id: orgId,
          p_project_id: assigned.project.id,
          p_user_id: customer.id,
        })
      ).error,
    ).toBeNull();
    expect(success(await customer.client.from('quotations').select('id').eq('id', assignedQuote.id))).toEqual(
      [],
    );
  });

  it('serialises issuance with staff role revocation and rechecks authority after waiting', async () => {
    const project = await createProject();
    const value = await source(project.project.id, sales.id);
    const lock = new Client({ connectionString: dbUrl });
    await lock.connect();
    try {
      await lock.query('begin');
      await lock.query('select id from public.organisations where id = $1 for update', [orgId]);
      const pending = service
        .rpc('issue_quotation', issueArguments(project.project.id, value, sales.id))
        .then((result) => result);
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const locks = await db.query(
          "select count(*)::int as count from pg_stat_activity where wait_event_type = 'Lock' and query like '%issue_quotation%' and pid <> pg_backend_pid()",
        );
        if (locks.rows[0].count > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await lock.query(
        "update public.organisation_members set role = 'customer' where organisation_id = $1 and user_id = $2",
        [orgId, sales.id],
      );
      await lock.query('commit');
      expect((await pending).error?.code).toBe('42501');
      expect(await count(project.project.id)).toBe(0);
    } finally {
      await lock.query('rollback');
      await lock.end();
      await db.query(
        "update public.organisation_members set role = 'salesperson' where organisation_id = $1 and user_id = $2",
        [orgId, sales.id],
      );
    }
  });
});
