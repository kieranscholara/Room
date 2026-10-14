import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { localTestPreflight } from '../scripts/test-preflight.mjs';
import { encryptInventoryToken } from '@roomsell/inventory/server';
import { createDemoScene } from '@roomsell/scene-core';

function checked<T extends { data: unknown; error: { message: string } | null }>(
  result: T,
): NonNullable<T['data']> {
  if (result.error || result.data === null)
    throw new Error(result.error?.message ?? 'Expected database result.');
  return result.data as NonNullable<T['data']>;
}
interface Actor {
  id: string;
  client: SupabaseClient;
}
interface Connection {
  id: string;
  revision: number;
}
describe.skipIf(process.env.ROOMSELL_RUN_DATABASE_TESTS !== '1')(
  'real tenant-safe inventory synchronization',
  () => {
    let service: SupabaseClient;
    let anonymous: SupabaseClient;
    let ownerA: Actor;
    let ownerB: Actor;
    let sales: Actor;
    let customer: Actor;
    let admin: Actor;
    let orgA: string;
    let orgB: string;
    let variantA: string;
    let variantA2: string;
    let variantB: string;
    let productA: string;
    let productB: string;
    let sceneId: string;
    const identities: string[] = [];
    const orgs: string[] = [];
    const key = randomBytes(32).toString('base64');
    const fixtureToken = `test-${randomBytes(20).toString('hex')}`;
    let fixtureCounter = 0;

    async function connection(): Promise<Connection> {
      const result = await service.rpc('inventory_connection_write', {
        p_org_id: orgA,
        p_actor_id: ownerA.id,
        p_connection_id: null,
        p_expected_revision: null,
        p_config: {
          name: `Inventory test ${++fixtureCounter}`,
          endpoint: 'https://inventory.example.test/snapshot',
          enabled: true,
        },
        p_token_envelope: encryptInventoryToken(fixtureToken, key, orgA),
      });
      return checked(result);
    }
    function mappings() {
      return [
        {
          externalProductId: 'external-a',
          externalVariantId: 'external-a1',
          productId: productA,
          variantId: variantA,
        },
        {
          externalProductId: 'external-a',
          externalVariantId: 'external-a2',
          productId: productA,
          variantId: variantA2,
        },
      ];
    }
    async function mappedConnection() {
      // The one-connector-per-variant invariant is deliberate, so clean fixture
      // mappings before creating the next independent test connection.
      checked(await service.from('inventory_mappings').delete().eq('organisation_id', orgA).select());
      const created = await connection();
      return checked(
        await service.rpc('inventory_replace_mappings', {
          p_org_id: orgA,
          p_actor_id: ownerA.id,
          p_connection_id: created.id,
          p_expected_revision: created.revision,
          p_mappings: mappings(),
        }),
      ) as Connection;
    }
    function items() {
      return mappings().map((mapping, index) => ({
        ...mapping,
        sku: `INVENTORY-A${index + 1}`,
        currency: 'EUR',
        priceMinor: 12500 + index * 1000,
        stockQuantity: 8,
        availability: 'in_stock',
      }));
    }
    function apply(
      conn: Connection,
      input = items(),
      generatedAt = new Date().toISOString(),
      actor = ownerA.id,
    ) {
      return service.rpc('inventory_apply_snapshot', {
        p_org_id: orgA,
        p_actor_id: actor,
        p_connection_id: conn.id,
        p_expected_revision: conn.revision,
        p_generated_at: generatedAt,
        p_items: input,
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
      async function actor(label: string): Promise<Actor> {
        const email = `${label}-${randomUUID()}@roomsell.test`;
        const password = `${randomBytes(24).toString('base64url')}!Aa9`;
        const user = checked(
          await service.auth.admin.createUser({ email, password, email_confirm: true }),
        ).user;
        if (!user) throw new Error('Expected an inventory test identity.');
        identities.push(user.id);
        const client = createClient(status.API_URL, status.ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        checked(await client.auth.signInWithPassword({ email, password }));
        return { id: user.id, client };
      }
      ownerA = await actor('inventory-owner-a');
      ownerB = await actor('inventory-owner-b');
      sales = await actor('inventory-sales');
      customer = await actor('inventory-customer');
      admin = await actor('inventory-admin');
      orgA = checked(
        await ownerA.client.rpc('create_organisation', { p_name: 'Inventory retailer A', p_currency: 'EUR' }),
      ).id;
      orgs.push(orgA);
      orgB = checked(
        await ownerB.client.rpc('create_organisation', { p_name: 'Inventory retailer B', p_currency: 'EUR' }),
      ).id;
      orgs.push(orgB);
      checked(
        await service
          .from('organisation_members')
          .insert([
            { organisation_id: orgA, user_id: sales.id, role: 'salesperson' },
            { organisation_id: orgA, user_id: customer.id, role: 'customer' },
            { organisation_id: orgA, user_id: admin.id, role: 'admin' },
          ])
          .select(),
      );
      const inventory = {
        name: 'Inventory test bed',
        color: '#112233',
        material: 'Oak',
        priceMinor: 10000,
        dimensions: { width: 1.6, depth: 2, height: 1 },
        active: true,
        availability: 'in_stock',
        stockQuantity: 2,
        leadTimeDays: 7,
      };
      productA = checked(
        await service.rpc('catalogue_product_write', {
          p_org_id: orgA,
          p_actor_id: ownerA.id,
          p_product_id: null,
          p_product: {
            ...inventory,
            sku: 'INVENTORY-PARENT-A',
            category: 'bed',
            currency: 'EUR',
            variants: [
              { ...inventory, sku: 'INVENTORY-A1' },
              { ...inventory, sku: 'INVENTORY-A2' },
            ],
          },
        }),
      );
      productB = checked(
        await service.rpc('catalogue_product_write', {
          p_org_id: orgB,
          p_actor_id: ownerB.id,
          p_product_id: null,
          p_product: {
            ...inventory,
            sku: 'INVENTORY-PARENT-B',
            category: 'bed',
            currency: 'EUR',
            variants: [{ ...inventory, sku: 'INVENTORY-B1' }],
          },
        }),
      );
      const variants = checked(
        await service.from('product_variants').select('id,sku').eq('product_id', productA),
      );
      variantA = variants.find((row) => row.sku === 'INVENTORY-A1')!.id;
      variantA2 = variants.find((row) => row.sku === 'INVENTORY-A2')!.id;
      variantB = checked(
        await service.from('product_variants').select('id').eq('product_id', productB).single(),
      ).id;
      const scene = createDemoScene();
      scene.objects = [];
      scene.groups = [];
      sceneId = checked(
        await service.rpc('create_project', {
          p_org_id: orgA,
          p_actor_id: ownerA.id,
          p_customer_id: null,
          p_name: 'Inventory stable scene',
          p_budget_minor: 0,
          p_currency: 'EUR',
          p_style: '',
          p_room_type: 'bedroom',
          p_scene: scene,
        }),
      ).scene.id;
    }, 60_000);
    afterAll(async () => {
      if (!service) return;
      for (const org of orgs) await service.from('organisations').delete().eq('id', org);
      for (const user of identities) await service.auth.admin.deleteUser(user);
    });

    it('isolates metadata and audit rows by tenant and role and denies direct credential/RPC access', async () => {
      const conn = await connection();
      const request = {
        p_org_id: orgA,
        p_actor_id: ownerA.id,
        p_connection_id: conn.id,
        p_expected_revision: conn.revision,
        p_config: { name: 'Forbidden', endpoint: 'https://inventory.example.test', enabled: true },
        p_token_envelope: null,
      };
      expect(
        checked(await ownerA.client.from('inventory_connections').select('id').eq('id', conn.id)),
      ).toEqual([{ id: conn.id }]);
      for (const client of [ownerB.client, sales.client, customer.client])
        expect(checked(await client.from('inventory_connections').select('id').eq('id', conn.id))).toEqual(
          [],
        );
      expect((await ownerA.client.from('inventory_credentials').select('*')).error?.code).toBe('42501');
      expect((await anonymous.from('inventory_connections').select('*')).error?.code).toBe('42501');
      expect((await ownerA.client.rpc('inventory_connection_write', request)).error?.code).toBe('42501');
      expect(
        (await ownerA.client.from('inventory_connections').update({ name: 'Forbidden' }).eq('id', conn.id))
          .error?.code,
      ).toBe('42501');
      const stored = checked(
        await service
          .from('inventory_credentials')
          .select('token_envelope')
          .eq('connection_id', conn.id)
          .single(),
      );
      expect(JSON.stringify(stored)).not.toContain(fixtureToken);
    });
    it('rejects cross-tenant mappings atomically and keeps the existing configuration revision', async () => {
      const conn = await mappedConnection();
      const result = await service.rpc('inventory_replace_mappings', {
        p_org_id: orgA,
        p_actor_id: ownerA.id,
        p_connection_id: conn.id,
        p_expected_revision: conn.revision,
        p_mappings: [{ ...mappings()[0], productId: productB, variantId: variantB }],
      });
      expect(result.error?.code).toBe('23503');
      expect(
        checked(await service.from('inventory_mappings').select('variant_id').eq('connection_id', conn.id)),
      ).toHaveLength(2);
      expect(
        checked(await service.from('inventory_connections').select('revision').eq('id', conn.id).single())
          .revision,
      ).toBe(conn.revision);
    });
    it('rejects competing connector ownership of a mapped catalogue variant', async () => {
      const original = await mappedConnection();
      const competing = await connection();
      const result = await service.rpc('inventory_replace_mappings', {
        p_org_id: orgA,
        p_actor_id: ownerA.id,
        p_connection_id: competing.id,
        p_expected_revision: competing.revision,
        p_mappings: [mappings()[0]],
      });
      expect(result.error?.code).toBe('23505');
      expect(
        checked(await service.from('inventory_mappings').select('connection_id').eq('variant_id', variantA)),
      ).toEqual([{ connection_id: original.id }]);
      expect(
        checked(await service.from('inventory_mappings').select('*').eq('connection_id', competing.id)),
      ).toEqual([]);
    });
    it('applies exact prices and stock while preserving variant dimensions and saved scenes', async () => {
      const conn = await mappedConnection();
      const sceneBefore = checked(
        await service.from('scenes').select('data,version').eq('id', sceneId).single(),
      );
      const dimsBefore = checked(
        await service
          .from('product_variants')
          .select('id,width_m,depth_m,height_m')
          .eq('product_id', productA)
          .order('id'),
      );
      const result = checked(await apply(conn));
      expect(result.run.status).toBe('completed');
      expect(result.run.item_count).toBe(2);
      expect(result.connection.revision).toBe(conn.revision + 1);
      expect(
        checked(
          await service
            .from('product_variants')
            .select('price_minor,stock_quantity,availability')
            .eq('id', variantA)
            .single(),
        ),
      ).toEqual({ price_minor: 12500, stock_quantity: 8, availability: 'in_stock' });
      expect(
        checked(
          await service
            .from('products')
            .select('price_minor,stock_quantity,availability')
            .eq('id', productA)
            .single(),
        ),
      ).toEqual({ price_minor: 12500, stock_quantity: 16, availability: 'in_stock' });
      expect(
        checked(
          await service
            .from('product_variants')
            .select('id,width_m,depth_m,height_m')
            .eq('product_id', productA)
            .order('id'),
        ),
      ).toEqual(dimsBefore);
      expect(checked(await service.from('scenes').select('data,version').eq('id', sceneId).single())).toEqual(
        sceneBefore,
      );
    });
    it('rolls back every item on a later currency conflict and records only a sanitized failure', async () => {
      const conn = await mappedConnection();
      const before = checked(
        await service
          .from('product_variants')
          .select('price_minor,stock_quantity,updated_at')
          .eq('id', variantA)
          .single(),
      );
      const input = items();
      input[0].priceMinor = 77777;
      input[1].currency = 'GBP';
      const result = checked(await apply(conn, input));
      expect(result.run).toMatchObject({ status: 'failed', item_count: 0, error_code: 'catalogue_conflict' });
      expect(
        checked(
          await service
            .from('product_variants')
            .select('price_minor,stock_quantity,updated_at')
            .eq('id', variantA)
            .single(),
        ),
      ).toEqual(before);
      expect(
        checked(
          await service
            .from('inventory_connections')
            .select('revision,last_synced_at')
            .eq('id', conn.id)
            .single(),
        ),
      ).toEqual({ revision: conn.revision, last_synced_at: null });
      expect(
        JSON.stringify(
          checked(await ownerA.client.from('inventory_sync_runs').select('*').eq('connection_id', conn.id)),
        ),
      ).not.toContain(fixtureToken);
      expect(
        checked(await ownerB.client.from('inventory_sync_runs').select('*').eq('connection_id', conn.id)),
      ).toEqual([]);
    });
    it('rejects duplicate, missing and wrong-SKU rows without partial updates', async () => {
      const conn = await mappedConnection();
      const wrongSku = items();
      wrongSku[1].sku = 'INVENTED';
      for (const input of [[items()[0]], [items()[0], items()[0]], wrongSku]) {
        const result = checked(await apply(conn, input));
        expect(result.run.status).toBe('failed');
        expect(result.run.item_count).toBe(0);
      }
    });
    it('rejects stale configurations, disabled connectors and replayed source snapshots', async () => {
      const conn = await mappedConnection();
      expect((await apply({ ...conn, revision: conn.revision - 1 })).error?.code).toBe('40001');
      const timestamp = new Date(Date.now() - 1000).toISOString();
      const first = checked(await apply(conn, items(), timestamp));
      expect(checked(await apply(first.connection, items(), timestamp)).run.error_code).toBe(
        'stale_snapshot',
      );
      expect(
        checked(await apply(first.connection, items(), new Date(Date.now() - 16 * 60_000).toISOString())).run
          .error_code,
      ).toBe('stale_snapshot');
      const disabled = checked(
        await service.rpc('inventory_connection_write', {
          p_org_id: orgA,
          p_actor_id: ownerA.id,
          p_connection_id: conn.id,
          p_expected_revision: first.connection.revision,
          p_config: {
            name: 'Disabled connector',
            endpoint: 'https://inventory.example.test',
            enabled: false,
          },
          p_token_envelope: null,
        }),
      );
      expect((await apply(disabled)).error?.code).toBe('40001');
    });
    it('rechecks manager authority for a revoked actor and never applies a salesperson sync', async () => {
      const conn = await mappedConnection();
      expect((await apply(conn, items(), new Date().toISOString(), sales.id)).error?.code).toBe('42501');
      checked(
        await service
          .from('organisation_members')
          .update({ role: 'customer' })
          .eq('organisation_id', orgA)
          .eq('user_id', admin.id)
          .select(),
      );
      expect((await apply(conn, items(), new Date().toISOString(), admin.id)).error?.code).toBe('42501');
    });
  },
);
