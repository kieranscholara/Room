import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { localTestPreflight } from '../scripts/test-preflight.mjs';
import { Client } from 'pg';
import { createDemoScene, type Scene } from '@roomsell/scene-core';

// These tests use actual Supabase Auth, PostgREST, PostgreSQL RLS and private Storage.
// The explicit flag prevents a unit-test command silently depending on local services.
const runDatabaseTests = process.env.ROOMSELL_RUN_DATABASE_TESTS === '1';
interface LocalStatus {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}
interface Identity {
  id: string;
  email: string;
  client: SupabaseClient;
}
interface SceneRow {
  id: string;
  organisation_id: string;
  project_id: string;
  room_id: string;
  version: number;
  data: Scene;
  history: Scene[];
  future: Scene[];
}
interface ProjectBundle {
  project: { id: string; organisation_id: string };
  scene: SceneRow;
}

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
function assertSuccess<T extends { data: unknown; error: { message: string } | null }>(
  result: T,
): NonNullable<T['data']> {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('Expected a database result');
  return result.data as NonNullable<T['data']>;
}

describe.skipIf(!runDatabaseTests)('real Supabase tenant and authoritative scene security', () => {
  let service: SupabaseClient;
  let anonymous: SupabaseClient;
  let database: Client;
  let databaseUrl: string;
  let ownerA: Identity;
  let ownerB: Identity;
  let salesA: Identity;
  let customerA: Identity;
  let adminA: Identity;
  let orgA: string;
  let orgB: string;
  let customerRecordA: string;
  let customerRecordB: string;
  let projectA: ProjectBundle;
  let concurrentProject: ProjectBundle;
  let projectB: ProjectBundle;
  let productA: string;
  let productB: string;
  const identities: Identity[] = [];
  const organisationIds: string[] = [];
  const storagePaths: string[] = [];

  async function identity(label: string, status: LocalStatus): Promise<Identity> {
    const email = `${label}-${randomUUID()}@roomsell.test`;
    const password = `${randomBytes(24).toString('base64url')}!Aa7`;
    const user = assertSuccess(
      await service.auth.admin.createUser({ email, password, email_confirm: true }),
    ).user;
    if (!user) throw new Error('Auth did not create a test identity');
    const client = createClient(status.API_URL, status.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    assertSuccess(await client.auth.signInWithPassword({ email, password }));
    const result = { id: user.id, email, client };
    identities.push(result);
    return result;
  }

  async function invite(user: Identity, role: string) {
    const token = randomBytes(32).toString('base64url');
    assertSuccess(
      await ownerA.client.rpc('create_invitation', {
        p_org_id: orgA,
        p_email: user.email,
        p_role: role,
        p_token_hash: hash(token),
      }),
    );
    return assertSuccess(await user.client.rpc('accept_invitation', { p_token: token }));
  }

  async function createProject(
    organisationId: string,
    actorId: string,
    customerId: string | null,
    name: string,
    scene = createDemoScene(),
  ) {
    return assertSuccess(
      await service.rpc('create_project', {
        p_org_id: organisationId,
        p_actor_id: actorId,
        p_customer_id: customerId,
        p_name: name,
        p_budget_minor: 200000,
        p_currency: 'EUR',
        p_style: 'Natural',
        p_room_type: 'bedroom',
        p_scene: scene,
      }),
    ) as ProjectBundle;
  }

  function commit(scene: SceneRow, actorId: string, replacement = scene.data) {
    return service.rpc('commit_scene', {
      p_scene_id: scene.id,
      p_actor_id: actorId,
      p_expected_version: scene.version,
      p_scene: replacement,
      p_history: [scene.data],
      p_future: [],
      p_operation: {
        type: 'locks',
        objectId: 'bed',
        locks: { position: true, rotation: false, product: false },
      },
    });
  }

  function catalogueInput(sku: string) {
    const inventory = {
      sku,
      name: 'Security catalogue bed',
      color: '#112233',
      material: 'Oak',
      priceMinor: 125000,
      dimensions: { width: 1.6, depth: 2, height: 1 },
      active: true,
      availability: 'in_stock',
      stockQuantity: 3,
      leadTimeDays: 7,
    };
    return { ...inventory, category: 'bed', currency: 'EUR', variants: [{ ...inventory }] };
  }

  async function writeCatalogue(input: ReturnType<typeof catalogueInput>) {
    return assertSuccess(
      await service.rpc('catalogue_product_write', {
        p_org_id: orgA,
        p_actor_id: ownerA.id,
        p_product_id: null,
        p_product: input,
      }),
    ) as string;
  }

  beforeAll(async () => {
    const status: LocalStatus = await localTestPreflight();
    service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anonymous = createClient(status.API_URL, status.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    databaseUrl = status.DB_URL;
    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    ownerA = await identity('owner-a', status);
    ownerB = await identity('owner-b', status);
    salesA = await identity('sales-a', status);
    customerA = await identity('customer-a', status);
    adminA = await identity('admin-a', status);
    orgA = assertSuccess(
      await ownerA.client.rpc('create_organisation', { p_name: 'Security retailer A', p_currency: 'EUR' }),
    ).id;
    organisationIds.push(orgA);
    orgB = assertSuccess(
      await ownerB.client.rpc('create_organisation', { p_name: 'Security retailer B', p_currency: 'GBP' }),
    ).id;
    organisationIds.push(orgB);
    await invite(salesA, 'salesperson');
    await invite(customerA, 'customer');
    await invite(adminA, 'admin');
    customerRecordA = assertSuccess(
      await ownerA.client
        .from('customers')
        .insert({ organisation_id: orgA, name: 'Customer A', email: 'customer-a@example.test' })
        .select('id')
        .single(),
    ).id;
    customerRecordB = assertSuccess(
      await ownerB.client
        .from('customers')
        .insert({ organisation_id: orgB, name: 'Customer B', email: 'customer-b@example.test' })
        .select('id')
        .single(),
    ).id;
    projectA = await createProject(orgA, ownerA.id, customerRecordA, 'Customer-visible project A');
    concurrentProject = await createProject(orgA, ownerA.id, customerRecordA, 'Private concurrent project A');
    projectB = await createProject(orgB, ownerB.id, customerRecordB, 'Private project B');
    const product = {
      sku: 'REAL-TEST-BED',
      name: 'Test catalogue bed',
      category: 'bed',
      price_minor: 129900,
      currency: 'EUR',
      width_m: 1.6,
      depth_m: 2,
      height_m: 1,
      color: '#b89372',
      material: 'Oak',
      stock_quantity: 3,
    };
    productA = assertSuccess(
      await service
        .from('products')
        .insert({ ...product, organisation_id: orgA })
        .select('id')
        .single(),
    ).id;
    productB = assertSuccess(
      await service
        .from('products')
        .insert({ ...product, organisation_id: orgB })
        .select('id')
        .single(),
    ).id;
  }, 60000);

  afterAll(async () => {
    if (service && storagePaths.length) await service.storage.from('product-assets').remove(storagePaths);
    if (database) {
      // PostgreSQL setup/cleanup is privileged; all access assertions use real JWTs/RLS.
      await database.query('delete from public.organisations where id = any($1::uuid[])', [organisationIds]);
      await database.end();
    }
    if (service) for (const user of identities) await service.auth.admin.deleteUser(user.id);
  });

  it('uses real signed-in identities and filters both tenant data and membership lists', async () => {
    expect(assertSuccess(await ownerA.client.auth.getUser()).user?.id).toBe(ownerA.id);
    expect(assertSuccess(await ownerB.client.auth.getUser()).user?.id).toBe(ownerB.id);
    expect(
      assertSuccess(await ownerA.client.from('organisations').select('id')).map((row) => row.id),
    ).toEqual([orgA]);
    expect(
      assertSuccess(await ownerB.client.from('organisations').select('id')).map((row) => row.id),
    ).toEqual([orgB]);
    expect(assertSuccess(await ownerA.client.from('customers').select('id')).map((row) => row.id)).toEqual([
      customerRecordA,
    ]);
    expect(assertSuccess(await ownerB.client.from('customers').select('id')).map((row) => row.id)).toEqual([
      customerRecordB,
    ]);
    expect(assertSuccess(await ownerA.client.from('products').select('id')).map((row) => row.id)).toEqual([
      productA,
    ]);
    expect(assertSuccess(await ownerA.client.rpc('list_members', { p_org_id: orgA }))).toHaveLength(4);
    expect((await ownerB.client.rpc('list_members', { p_org_id: orgA })).error?.code).toBe('42501');
    expect((await anonymous.from('projects').select('id')).error).not.toBeNull();
  });

  it('denies foreign tenant writes and enforces composite tenant foreign keys', async () => {
    expect(
      (await ownerA.client.from('customers').insert({ organisation_id: orgB, name: 'Forged customer' })).error
        ?.code,
    ).toBe('42501');
    const variant = {
      organisation_id: orgA,
      product_id: productB,
      sku: 'FOREIGN-VARIANT',
      name: 'Foreign relation',
      color: '#ffffff',
      price_minor: 100,
      width_m: 1,
      depth_m: 1,
      height_m: 1,
    };
    expect((await ownerA.client.from('product_variants').insert(variant)).error?.code).toBe('42501');
    expect((await service.from('product_variants').insert(variant)).error?.code).toBe('23503');
    const foreignCustomer = await service.rpc('create_project', {
      p_org_id: orgA,
      p_actor_id: ownerA.id,
      p_customer_id: customerRecordB,
      p_name: 'Foreign customer project',
      p_budget_minor: 100,
      p_currency: 'EUR',
      p_style: '',
      p_room_type: 'bedroom',
      p_scene: createDemoScene(),
    });
    expect(foreignCustomer.error?.code).toBe('23503');
    const directSql = await database.query('begin');
    expect(directSql.command).toBe('BEGIN');
    try {
      await database.query('set local role authenticated');
      await database.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ownerB.id, role: 'authenticated' }),
      ]);
      const rows = await database.query('select id from public.scenes where id = $1', [projectA.scene.id]);
      expect(rows.rowCount).toBe(0);
    } finally {
      await database.query('rollback');
    }
  });

  it('prevents membership forgery, self-promotion and removing the last owner', async () => {
    expect(
      (await salesA.client.from('organisation_members').update({ role: 'owner' }).eq('user_id', salesA.id))
        .error?.code,
    ).toBe('42501');
    expect(
      (
        await salesA.client
          .from('organisation_members')
          .insert({ organisation_id: orgB, user_id: salesA.id, role: 'owner' })
      ).error?.code,
    ).toBe('42501');
    expect(
      (await salesA.client.rpc('set_member_role', { p_org_id: orgA, p_user_id: salesA.id, p_role: 'owner' }))
        .error?.code,
    ).toBe('42501');
    expect(
      (await adminA.client.rpc('set_member_role', { p_org_id: orgA, p_user_id: adminA.id, p_role: 'owner' }))
        .error?.code,
    ).toBe('42501');
    expect(
      (
        await adminA.client.rpc('set_member_role', {
          p_org_id: orgA,
          p_user_id: ownerA.id,
          p_role: 'designer',
        })
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await ownerA.client.rpc('set_member_role', {
          p_org_id: orgA,
          p_user_id: ownerA.id,
          p_role: 'salesperson',
        })
      ).error?.code,
    ).toBe('23514');
    expect(
      (
        await salesA.client.rpc('create_invitation', {
          p_org_id: orgA,
          p_email: ownerB.email,
          p_role: 'owner',
          p_token_hash: hash(randomUUID()),
        })
      ).error?.code,
    ).toBe('42501');
    expect(assertSuccess(await salesA.client.from('organisation_members').select('role'))).toEqual([
      { role: 'salesperson' },
    ]);
  });

  it('binds invitations to confirmed email, hashes tokens, revokes them and rejects reuse/expiry', async () => {
    const wrongAccountToken = randomBytes(32).toString('base64url');
    const invitation = assertSuccess(
      await ownerA.client.rpc('create_invitation', {
        p_org_id: orgA,
        p_email: ownerB.email,
        p_role: 'designer',
        p_token_hash: hash(wrongAccountToken),
      }),
    );
    expect(invitation.token_hash).toBeUndefined();
    expect((await salesA.client.rpc('accept_invitation', { p_token: wrongAccountToken })).error?.code).toBe(
      '42501',
    );
    expect(
      (await ownerA.client.rpc('revoke_invitation', { p_org_id: orgA, p_invitation_id: invitation.id }))
        .error,
    ).toBeNull();
    expect((await ownerB.client.rpc('accept_invitation', { p_token: wrongAccountToken })).error?.code).toBe(
      '42501',
    );
    const expiredToken = randomBytes(32).toString('base64url');
    const expired = assertSuccess(
      await ownerA.client.rpc('create_invitation', {
        p_org_id: orgA,
        p_email: ownerB.email,
        p_role: 'designer',
        p_token_hash: hash(expiredToken),
      }),
    );
    await database.query(
      "update public.organisation_invitations set expires_at = now() - interval '1 second' where id = $1",
      [expired.id],
    );
    expect((await ownerB.client.rpc('accept_invitation', { p_token: expiredToken })).error?.code).toBe(
      '42501',
    );
    const acceptedToken = randomBytes(32).toString('base64url');
    assertSuccess(
      await ownerA.client.rpc('create_invitation', {
        p_org_id: orgA,
        p_email: ownerB.email,
        p_role: 'designer',
        p_token_hash: hash(acceptedToken),
      }),
    );
    const accepted = assertSuccess(await ownerB.client.rpc('accept_invitation', { p_token: acceptedToken }));
    expect(accepted).toMatchObject({ organisationId: orgA, userId: ownerB.id, role: 'designer' });
    expect((await ownerB.client.rpc('accept_invitation', { p_token: acceptedToken })).error?.code).toBe(
      '42501',
    );
    // Remove the deliberately accepted additional membership so later isolation tests
    // continue to use owner B solely as a member of retailer B.
    await database.query(
      'delete from public.organisation_members where organisation_id = $1 and user_id = $2',
      [orgA, ownerB.id],
    );
  });

  it('restricts customers to explicitly shared projects and separately grants scene editing', async () => {
    expect(assertSuccess(await customerA.client.from('projects').select('id'))).toEqual([]);
    expect(
      (
        await ownerA.client.rpc('grant_project_access', {
          p_project_id: projectA.project.id,
          p_org_id: orgA,
          p_user_id: customerA.id,
          p_can_edit: false,
        })
      ).error,
    ).toBeNull();
    expect(assertSuccess(await customerA.client.from('projects').select('id')).map((row) => row.id)).toEqual([
      projectA.project.id,
    ]);
    expect(assertSuccess(await customerA.client.from('scenes').select('id')).map((row) => row.id)).toEqual([
      projectA.scene.id,
    ]);
    expect(assertSuccess(await customerA.client.from('customers').select('id'))).toEqual([]);
    expect(assertSuccess(await customerA.client.from('products').select('id'))).toEqual([]);
    expect((await customerA.client.rpc('list_members', { p_org_id: orgA })).error?.code).toBe('42501');
    expect((await commit(projectA.scene, customerA.id)).error?.code).toBe('42501');
    expect(
      (await customerA.client.from('project_access').update({ can_edit: true }).eq('user_id', customerA.id))
        .error,
    ).not.toBeNull();
    expect(
      (
        await customerA.client.rpc('grant_project_access', {
          p_project_id: projectA.project.id,
          p_org_id: orgA,
          p_user_id: customerA.id,
          p_can_edit: true,
        })
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await ownerA.client.rpc('grant_project_access', {
          p_project_id: projectA.project.id,
          p_org_id: orgA,
          p_user_id: customerA.id,
          p_can_edit: true,
        })
      ).error,
    ).toBeNull();
    expect(assertSuccess(await commit(projectA.scene, customerA.id)).version).toBe(1);
    expect(
      assertSuccess(await customerA.client.from('projects').select('id')).some(
        (row) => row.id === projectB.project.id,
      ),
    ).toBe(false);
  });

  it('blocks direct replacement scenes, lock bypass, forged previews and authenticated commit RPCs', async () => {
    const changed = structuredClone(concurrentProject.scene.data);
    changed.objects.find((object) => object.id === 'wardrobe')!.transform.x = 0;
    expect(
      (await ownerA.client.from('scenes').update({ data: changed }).eq('id', concurrentProject.scene.id))
        .error?.code,
    ).toBe('42501');
    expect((await ownerA.client.from('scenes').insert(concurrentProject.scene)).error?.code).toBe('42501');
    expect(
      (
        await ownerA.client.rpc('commit_scene', {
          p_scene_id: concurrentProject.scene.id,
          p_actor_id: ownerA.id,
          p_expected_version: 0,
          p_scene: changed,
          p_history: [],
          p_future: [],
          p_operation: { type: 'forged' },
        })
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await ownerA.client.from('scene_proposals').insert({
          scene_id: concurrentProject.scene.id,
          organisation_id: orgA,
          actor_id: ownerA.id,
          base_version: 0,
          payload: { scene: changed },
        })
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await ownerA.client
          .from('scene_versions')
          .update({ data: changed })
          .eq('scene_id', concurrentProject.scene.id)
      ).error?.code,
    ).toBe('42501');
    expect(
      (await ownerA.client.from('scene_operations').delete().eq('scene_id', concurrentProject.scene.id)).error
        ?.code,
    ).toBe('42501');
    expect(
      assertSuccess(
        await ownerA.client.from('scenes').select('data').eq('id', concurrentProject.scene.id).single(),
      ).data,
    ).toEqual(concurrentProject.scene.data);
  });

  it('checks the trusted server actor again and keeps proposals private to their creator', async () => {
    expect((await commit(concurrentProject.scene, ownerB.id)).error?.code).toBe('42501');
    const proposalId = randomUUID();
    expect(
      (
        await service.from('scene_proposals').insert({
          id: proposalId,
          scene_id: concurrentProject.scene.id,
          organisation_id: orgA,
          actor_id: salesA.id,
          base_version: 0,
          payload: { proposal: { id: proposalId }, operation: { type: 'locks' } },
        })
      ).error,
    ).toBeNull();
    expect(
      assertSuccess(await salesA.client.from('scene_proposals').select('id').eq('id', proposalId)),
    ).toEqual([{ id: proposalId }]);
    expect(
      assertSuccess(await ownerA.client.from('scene_proposals').select('id').eq('id', proposalId)),
    ).toEqual([]);
    expect(
      assertSuccess(await ownerB.client.from('scene_proposals').select('id').eq('id', proposalId)),
    ).toEqual([]);
    const foreign = { ...concurrentProject.scene.data, organisationId: orgB };
    expect((await commit(concurrentProject.scene, ownerA.id, foreign)).error?.code).toBe('23514');
  });

  it('commits one of two competing versions atomically and records one immutable version/audit entry', async () => {
    const next = structuredClone(concurrentProject.scene.data);
    next.objects.find((object) => object.id === 'bed')!.locks.position = true;
    const results = await Promise.all([
      commit(concurrentProject.scene, ownerA.id, next),
      commit(concurrentProject.scene, salesA.id, next),
    ]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.error?.code === '40001')).toHaveLength(1);
    const saved = assertSuccess(
      await ownerA.client.from('scenes').select('*').eq('id', concurrentProject.scene.id).single(),
    );
    expect(saved.version).toBe(1);
    expect(saved.data.version).toBe(1);
    expect(saved.history).toEqual([concurrentProject.scene.data]);
    expect(saved.data.objects.find((object: { id: string }) => object.id === 'bed').locks.position).toBe(
      true,
    );
    expect(
      assertSuccess(
        await ownerA.client
          .from('scene_versions')
          .select('version')
          .eq('scene_id', saved.id)
          .order('version'),
      ),
    ).toEqual([{ version: 0 }, { version: 1 }]);
    expect(
      assertSuccess(
        await ownerA.client
          .from('scene_operations')
          .select('version')
          .eq('scene_id', saved.id)
          .order('version'),
      ),
    ).toEqual([{ version: 0 }, { version: 1 }]);
    expect(
      assertSuccess(await salesA.client.from('scene_proposals').select('id').eq('scene_id', saved.id)),
    ).toEqual([]);
  });

  it('enforces catalogue prices, dimensions, stock and owner/admin write permissions', async () => {
    expect(
      (await salesA.client.from('products').update({ price_minor: 1 }).eq('id', productA)).error?.code,
    ).toBe('42501');
    expect((await salesA.client.from('products').insert({ organisation_id: orgA })).error?.code).toBe(
      '42501',
    );
    expect(
      (await ownerA.client.from('products').update({ price_minor: -1 }).eq('id', productA)).error?.code,
    ).toBe('42501');
    expect((await service.from('products').update({ price_minor: -1 }).eq('id', productA)).error?.code).toBe(
      '23514',
    );
    expect((await service.from('products').update({ width_m: 0 }).eq('id', productA)).error?.code).toBe(
      '23514',
    );
    expect(
      (await service.from('products').update({ stock_quantity: -1 }).eq('id', productA)).error?.code,
    ).toBe('23514');
    expect(
      (await service.from('products').update({ organisation_id: orgB }).eq('id', productA)).error?.code,
    ).toBe('23514');
    expect(
      assertSuccess(await salesA.client.from('products').select('price_minor').eq('id', productA).single())
        .price_minor,
    ).toBe(129900);
  });

  it('keeps Storage private across tenants and disallows uploads that bypass server validation', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFfsAAAAASUVORK5CYII=',
      'base64',
    );
    const path = `${orgA}/${productA}/${randomUUID()}.png`;
    expect(
      (await service.storage.from('product-assets').upload(path, png, { contentType: 'image/png' })).error,
    ).toBeNull();
    storagePaths.push(path);
    // A trusted server's staged upload remains inaccessible until validation is registered.
    expect((await ownerA.client.storage.from('product-assets').download(path)).error).not.toBeNull();
    expect((await salesA.client.storage.from('product-assets').download(path)).error).not.toBeNull();
    expect(
      (
        await service.from('product_assets').insert({
          organisation_id: orgA,
          product_id: productA,
          path,
          kind: 'image',
          mime_type: 'image/png',
          size_bytes: png.length,
          validation: { format: 'png', widthPixels: 1, heightPixels: 1 },
        })
      ).error,
    ).toBeNull();
    expect((await ownerA.client.storage.from('product-assets').download(path)).error).toBeNull();
    expect((await salesA.client.storage.from('product-assets').download(path)).error).toBeNull();
    expect((await ownerB.client.storage.from('product-assets').download(path)).error).not.toBeNull();
    expect((await customerA.client.storage.from('product-assets').download(path)).error).not.toBeNull();
    expect((await anonymous.storage.from('product-assets').download(path)).error).not.toBeNull();
    const unvalidatedPath = `${orgA}/${productA}/${randomUUID()}-unvalidated.png`;
    expect(
      (
        await ownerA.client.storage
          .from('product-assets')
          .upload(unvalidatedPath, png, { contentType: 'image/png' })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await ownerA.client.from('product_assets').insert({
          organisation_id: orgA,
          product_id: productA,
          path: unvalidatedPath,
          kind: 'image',
          mime_type: 'image/png',
          size_bytes: png.length,
        })
      ).error?.code,
    ).toBe('42501');
    const { rows } = await database.query("select public from storage.buckets where id = 'product-assets'");
    expect(rows).toEqual([{ public: false }]);
  });

  it('restricts atomic catalogue RPCs to verified administrators and rolls back a duplicate import', async () => {
    const input = catalogueInput(`RPC-${randomUUID()}`);
    const args = { p_org_id: orgA, p_actor_id: ownerA.id, p_product_id: null, p_product: input };
    expect((await ownerA.client.rpc('catalogue_product_write', args)).error?.code).toBe('42501');
    expect((await anonymous.rpc('catalogue_product_write', args)).error?.code).toBe('42501');
    expect(
      (await service.rpc('catalogue_product_write', { ...args, p_actor_id: salesA.id })).error?.code,
    ).toBe('42501');
    expect(
      (await service.rpc('catalogue_product_write', { ...args, p_actor_id: ownerB.id })).error?.code,
    ).toBe('42501');
    const productId = await writeCatalogue(input);
    const newInput = catalogueInput(`IMPORT-${randomUUID()}`);
    const failed = assertSuccess(
      await service.rpc('catalogue_import_products', {
        p_org_id: orgA,
        p_actor_id: ownerA.id,
        p_file_name: 'duplicate.csv',
        p_products: [newInput, input],
        p_row_count: 2,
        p_errors: [],
      }),
    );
    expect(failed).toMatchObject({ status: 'failed', summary: { productCount: 0, variantCount: 0 } });
    expect(failed.summary.errors).toHaveLength(1);
    expect(
      assertSuccess(
        await service.from('products').select('id').eq('organisation_id', orgA).eq('sku', newInput.sku),
      ),
    ).toEqual([]);
    expect(
      assertSuccess(
        await service
          .from('product_variants')
          .select('id')
          .eq('organisation_id', orgA)
          .eq('sku', newInput.variants[0].sku),
      ),
    ).toEqual([]);
    expect(assertSuccess(await service.from('products').select('id').eq('id', productId))).toHaveLength(1);
    const log = assertSuccess(
      await ownerA.client.from('catalogue_imports').select('status,summary').eq('id', failed.id).single(),
    );
    expect(log.status).toBe('failed');
    expect(log.summary.productCount).toBe(0);
  });

  it('caps retained variants and rolls back parent edits when a replacement would exceed the cap', async () => {
    const input = catalogueInput(`CAP-${randomUUID()}`);
    input.variants = Array.from({ length: 100 }, (_, index) => ({
      ...input.variants[0],
      sku: `${input.sku}-${index}`,
    }));
    const productId = await writeCatalogue(input);
    const variants = assertSuccess(
      await service.from('product_variants').select('id,sku').eq('product_id', productId),
    );
    expect(variants).toHaveLength(100);
    const replacement = {
      ...input,
      name: 'This parent update must roll back',
      variants: [
        ...variants.slice(0, 99).map(({ id, sku }) => ({ ...input.variants[0], id, sku })),
        { ...input.variants[0], sku: `${input.sku}-replacement` },
      ],
    };
    const result = await service.rpc('catalogue_product_write', {
      p_org_id: orgA,
      p_actor_id: ownerA.id,
      p_product_id: productId,
      p_product: replacement,
    });
    expect(result.error?.code).toBe('23514');
    expect(
      assertSuccess(await service.from('products').select('name').eq('id', productId).single()).name,
    ).toBe(input.name);
    const retained = assertSuccess(
      await service.from('product_variants').select('id,active').eq('product_id', productId),
    );
    expect(retained).toHaveLength(100);
    expect(retained.every((variant) => variant.active)).toBe(true);
  });

  it('rechecks canonical catalogue objects after waiting for an in-flight catalogue edit', async () => {
    const input = catalogueInput(`RACE-${randomUUID()}`),
      productId = await writeCatalogue(input);
    const variant = assertSuccess(
      await service.from('product_variants').select('id').eq('product_id', productId).single(),
    );
    const empty = createDemoScene();
    empty.objects = [];
    empty.groups = [];
    const bundle = await createProject(orgA, ownerA.id, null, 'Catalogue race project', empty);
    const object: Scene['objects'][number] = {
      id: randomUUID(),
      sku: input.variants[0].sku,
      variantId: variant.id,
      name: input.name,
      category: 'bed',
      dimensions: input.dimensions,
      transform: { x: 3, y: 0, z: 2.5, rotation: 0 },
      color: input.color,
      solid: true,
      locks: { position: false, rotation: false, product: false },
    };
    const proposalScene = { ...bundle.scene.data, objects: [object] };
    const catalogueConnection = new Client({ connectionString: databaseUrl }),
      editorConnection = new Client({ connectionString: databaseUrl });
    await catalogueConnection.connect();
    await editorConnection.connect();
    try {
      const cataloguePid = (await catalogueConnection.query('select pg_backend_pid() as pid')).rows[0].pid;
      const editorPid = (await editorConnection.query('select pg_backend_pid() as pid')).rows[0].pid;
      await catalogueConnection.query('begin');
      await catalogueConnection.query('set local role service_role');
      const changed = {
        ...input,
        variants: [{ ...input.variants[0], id: variant.id, dimensions: { ...input.dimensions, width: 1.8 } }],
      };
      await catalogueConnection.query('select public.catalogue_product_write($1,$2,$3,$4)', [
        orgA,
        ownerA.id,
        productId,
        JSON.stringify(changed),
      ]);
      await editorConnection.query('begin');
      await editorConnection.query('set local role service_role');
      const waitingCommit = editorConnection
        .query('select public.commit_scene($1,$2,$3,$4,$5,$6,$7)', [
          bundle.scene.id,
          ownerA.id,
          0,
          JSON.stringify(proposalScene),
          JSON.stringify([bundle.scene.data]),
          '[]',
          JSON.stringify({ action: 'accept', type: 'add-object', object }),
        ])
        .then(
          () => null,
          (error: { code: string }) => error.code,
        );
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const blockers = await database.query('select pg_blocking_pids($1) as blockers', [editorPid]);
        blocked = blockers.rows[0].blockers.includes(cataloguePid);
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await catalogueConnection.query('commit');
      expect(await waitingCommit).toBe('40001');
      const stored = assertSuccess(
        await service.from('scenes').select('version,data').eq('id', bundle.scene.id).single(),
      );
      expect(stored.version).toBe(0);
      expect(stored.data.objects).toEqual([]);
      expect(
        assertSuccess(await service.from('scene_versions').select('version').eq('scene_id', bundle.scene.id)),
      ).toEqual([{ version: 0 }]);
    } finally {
      await catalogueConnection.query('rollback');
      await editorConnection.query('rollback');
      await catalogueConnection.end();
      await editorConnection.end();
    }
  });

  it('serialises an in-flight scene commit with role revocation and revokes pending invitations', async () => {
    const token = randomBytes(32).toString('base64url');
    assertSuccess(
      await adminA.client.rpc('create_invitation', {
        p_org_id: orgA,
        p_email: ownerB.email,
        p_role: 'designer',
        p_token_hash: hash(token),
      }),
    );
    const editorConnection = new Client({ connectionString: databaseUrl });
    const revocationConnection = new Client({ connectionString: databaseUrl });
    await editorConnection.connect();
    await revocationConnection.connect();
    try {
      const editorPid = (await editorConnection.query('select pg_backend_pid() as pid')).rows[0].pid;
      const revocationPid = (await revocationConnection.query('select pg_backend_pid() as pid')).rows[0].pid;
      const current = assertSuccess(
        await service.from('scenes').select('*').eq('id', concurrentProject.scene.id).single(),
      ) as SceneRow;
      await editorConnection.query('begin');
      await editorConnection.query('set local role service_role');
      const committed = await editorConnection.query(
        'select public.commit_scene($1, $2, $3, $4, $5, $6, $7) as scene',
        [
          current.id,
          adminA.id,
          current.version,
          JSON.stringify(current.data),
          JSON.stringify(current.history),
          '[]',
          JSON.stringify({ type: 'accept' }),
        ],
      );
      await revocationConnection.query('begin');
      await revocationConnection.query('set local role authenticated');
      await revocationConnection.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ownerA.id, role: 'authenticated' }),
      ]);
      const revocation = revocationConnection.query('select public.set_member_role($1, $2, $3)', [
        orgA,
        adminA.id,
        'customer',
      ]);
      let waitsForEditor = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const blockers = await database.query('select pg_blocking_pids($1) as blockers', [revocationPid]);
        waitsForEditor = blockers.rows[0].blockers.includes(editorPid);
        if (waitsForEditor) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitsForEditor).toBe(true);
      await editorConnection.query('commit');
      await revocation;
      await revocationConnection.query('commit');
      expect((await commit(committed.rows[0].scene as SceneRow, adminA.id)).error?.code).toBe('42501');
      expect((await ownerB.client.rpc('accept_invitation', { p_token: token })).error?.code).toBe('42501');
      assertSuccess(
        await ownerA.client.rpc('set_member_role', { p_org_id: orgA, p_user_id: adminA.id, p_role: 'admin' }),
      );
    } finally {
      // Also releases locks if an assertion fails, so cleanup cannot hang.
      await editorConnection.query('rollback');
      await revocationConnection.query('rollback');
      await editorConnection.end();
      await revocationConnection.end();
    }
  });

  it('removes team membership and customer project grants atomically while preserving the last owner', async () => {
    expect(
      (await ownerA.client.rpc('remove_member', { p_org_id: orgA, p_user_id: ownerA.id })).error?.code,
    ).toBe('23514');
    expect(
      (await adminA.client.rpc('remove_member', { p_org_id: orgA, p_user_id: ownerA.id })).error?.code,
    ).toBe('42501');
    expect(
      (await customerA.client.rpc('remove_member', { p_org_id: orgA, p_user_id: ownerA.id })).error?.code,
    ).toBe('42501');
    expect(
      (await ownerA.client.rpc('remove_member', { p_org_id: orgA, p_user_id: customerA.id })).error,
    ).toBeNull();
    expect(assertSuccess(await customerA.client.from('projects').select('id'))).toEqual([]);
    expect(assertSuccess(await customerA.client.from('scenes').select('id'))).toEqual([]);
    expect(assertSuccess(await customerA.client.from('organisation_members').select('role'))).toEqual([]);
    expect(
      assertSuccess(await ownerA.client.from('project_access').select('user_id').eq('user_id', customerA.id)),
    ).toEqual([]);
  });
});
