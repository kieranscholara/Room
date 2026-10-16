import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes, randomUUID, createCipheriv, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { Buffer, File } from 'node:buffer';
const { fetch, FormData } = globalThis;
import process from 'node:process';
import console from 'node:console';
import { localTestPreflight } from './test-preflight.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(
  root,
  process.env.ROOMSELL_TEST_FIXTURE_SET === 'browser' ? '.local/e2e-fixtures' : '.local/fixtures',
);
const profilePath = path.join(directory, 'boreal.json');
const base = new URL(process.env.ROOMSELL_TEST_BASE_URL ?? 'http://127.0.0.1:3000');
if (
  base.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
  !['3000', '3100'].includes(base.port) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  base.pathname !== '/'
)
  throw new Error('The fixture seed requires the local app on port3000 or3100.');
const status = await localTestPreflight();
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
function data(result) {
  if (result.error || result.data === null)
    throw new Error('Fixture operation failed: ' + (result.error?.code ?? 'missing_result'));
  return result.data;
}
await mkdir(directory, { recursive: true, mode: 0o700 });
try {
  await writeFile(path.join(directory, 'worker-token'), randomBytes(32).toString('base64url'), {
    flag: 'wx',
    mode: 0o600,
  });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}

let previous;
try {
  previous = JSON.parse(await readFile(profilePath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Existing fixture profile could not be read.');
}
async function repairFixture(profile) {
  const manager = profile.personas.retailer;
  const verified = await admin.auth.admin.getUserById(manager.id);
  const role = data(
    await admin
      .from('organisation_members')
      .select('role')
      .eq('organisation_id', profile.organisationId)
      .eq('user_id', manager.id)
      .maybeSingle(),
  );
  if (
    verified.error ||
    verified.data.user?.email !== manager.email ||
    verified.data.user?.user_metadata.fictional_fixture !== 'boreal-living' ||
    role.role !== 'owner'
  )
    throw new Error('Existing fictional fixture authority could not be verified.');
  data(
    await admin
      .from('organisations')
      .update({ is_test: true })
      .eq('id', profile.organisationId)
      .select('id')
      .single(),
  );
  const connection = data(
    await admin
      .from('inventory_connections')
      .select('id,endpoint,order_endpoint,revision')
      .eq('id', profile.connectionId)
      .eq('organisation_id', profile.organisationId)
      .single(),
  );
  if (connection.endpoint === 'https://inventory.boreal-living.test/snapshot' && !connection.order_endpoint)
    data(
      await admin
        .from('inventory_connections')
        .update({
          order_endpoint: 'https://inventory.boreal-living.test/fulfilments',
          revision: connection.revision + 1,
        })
        .eq('id', connection.id)
        .select('id')
        .single(),
    );
  const cookies = new Map();
  async function request(route, options = {}) {
    const response = await fetch(new URL(route, base), {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Cookie: [...cookies].map(([name, value]) => name + '=' + value).join('; '),
        ...options.headers,
      },
    });
    for (const value of response.headers.getSetCookie()) {
      const first = value.split(';')[0],
        split = first.indexOf('=');
      cookies.set(first.slice(0, split), first.slice(split + 1));
    }
    if (!response.ok)
      throw new Error('Fixture repair HTTP failed at ' + route + ' (' + response.status + ')');
    return response.json();
  }
  await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: manager.email, password: manager.password }),
  });
  const catalogue = JSON.parse(
    await readFile(path.join(root, 'fixtures/boreal-living/catalogue.json'), 'utf8'),
  );
  for (const product of profile.products) {
    const record = data(
      await admin
        .from('products')
        .select('sku')
        .eq('id', product.id)
        .eq('organisation_id', profile.organisationId)
        .single(),
    );
    if (record.sku !== product.sku)
      throw new Error('Fixture product identity changed; preserving it for manual review.');
    let assets = data(
      await admin
        .from('product_assets')
        .select('id')
        .eq('product_id', product.id)
        .eq('organisation_id', profile.organisationId)
        .eq('kind', 'image')
        .eq('status', 'validated'),
    );
    const image = catalogue.products.find((item) => item.sku === product.sku)?.fixtureImage;
    if (!assets.length && image) {
      let bytes;
      try {
        bytes = await readFile(path.join(root, 'fixtures/boreal-living/images', image));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (bytes) {
        const form = new FormData();
        form.set('file', new File([bytes], image, { type: 'image/png' }));
        const asset = await request(
          '/api/organisations/' + profile.organisationId + '/catalogue/' + product.id + '/assets',
          { method: 'POST', body: form },
        );
        assets = [{ id: asset.id }];
      }
    }
    for (const variantId of product.variantIds) {
      const publication = await admin
        .from('published_offers')
        .select('id')
        .eq('variant_id', variantId)
        .maybeSingle();
      if (publication.error) throw new Error('Publication could not be inspected.');
      if (!publication.data)
        await request('/api/organisations/' + profile.organisationId + '/publications', {
          method: 'PUT',
          body: JSON.stringify({
            variantId,
            expectedRevision: 0,
            enabled: true,
            imageIds: assets.map((item) => item.id).slice(0, 4),
          }),
        });
    }
  }
  const references = data(
    await admin.from('room_references').select('id').eq('project_id', profile.projectId),
  );
  if (!references.length) {
    const bytes = await readFile(path.join(root, 'fixtures/boreal-living/images/room.png'));
    const form = new FormData();
    form.set('file', new File([bytes], 'Boreal Living fictional bedroom.png', { type: 'image/png' }));
    await request('/api/projects/' + profile.projectId + '/references', { method: 'POST', body: form });
  }
  if (!profile.consumerProjectId) {
    await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: profile.personas.consumer.email,
        password: profile.personas.consumer.password,
      }),
    });
    const personal = await request('/api/consumer/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Leo’s private fictional bedroom',
        currency: 'EUR',
        budgetMinor: 180000,
        room: {
          name: 'Leo’s fictional measured bedroom',
          width: 6,
          depth: 5,
          height: 2.7,
          measurementsConfirmed: true,
          openings: [],
          zones: [],
        },
      }),
    });
    profile.consumerProjectId = personal.id;
  }
  const temporary = profilePath + '.' + randomUUID();
  await writeFile(temporary, JSON.stringify(profile), { mode: 0o600 });
  await rename(temporary, profilePath);
}
if (previous) {
  const organisation = data(
    await admin.from('organisations').select('name').eq('id', previous.organisationId).maybeSingle(),
  );
  if (organisation.name !== 'Boreal Living — Fictional Test Retailer')
    throw new Error('Existing fixture identity did not match; no records changed.');
  await repairFixture(previous);
  console.log(
    'Boreal Living prepared idempotently with available images, publication and consumer design. Existing inventory, scenes and publication decisions were preserved. Open /testing.',
  );
  process.exit(0);
}
const configPath = path.join(root, 'apps/web/.env.local');
let environment = await readFile(configPath, 'utf8');
if (!/^ROOMSELL_LOCAL_SUPABASE=1\s*$/m.test(environment))
  throw new Error('Fixture setup requires an explicit local environment.');
if (!/^ROOMSELL_ENABLE_TEST_CUSTOMER=/m.test(environment)) {
  environment += '\nROOMSELL_ENABLE_TEST_CUSTOMER=1\n';
  await writeFile(configPath, environment, { mode: 0o600 });
}
let keyLine =
  process.env.ROOMSELL_CONNECTOR_ENCRYPTION_KEY ||
  /^ROOMSELL_CONNECTOR_ENCRYPTION_KEY=(.+)$/m.exec(environment)?.[1]?.trim();
if (!keyLine) {
  keyLine = randomBytes(32).toString('base64');
  environment += 'ROOMSELL_CONNECTOR_ENCRYPTION_KEY=' + keyLine + '\n';
  await writeFile(configPath, environment, { mode: 0o600 });
}
const key = Buffer.from(keyLine, 'base64');
if (key.length !== 32) throw new Error('A valid local encryption key is required.');
let createdOrg = null;
const createdUsers = [];
try {
  const personas = {};
  for (const persona of ['retailer', 'customer', 'consumer']) {
    const email = persona + '-' + randomUUID() + '@boreal-living.test',
      password = randomBytes(32).toString('base64url');
    const result = data(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name:
            persona === 'retailer'
              ? 'Alex — Fictional Showroom Manager'
              : persona === 'customer'
                ? 'Maya — Fictional Customer'
                : 'Leo — Fictional Consumer',
          fictional_fixture: 'boreal-living',
        },
      }),
    );
    if (!result.user) throw new Error('Fixture identity creation failed.');
    personas[persona] = { id: result.user.id, email, password };
    createdUsers.push(result.user.id);
  }
  const owner = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  data(await owner.auth.signInWithPassword(personas.retailer));
  const org = data(
    await owner.rpc('create_organisation', {
      p_name: 'Boreal Living — Fictional Test Retailer',
      p_currency: 'EUR',
    }),
  );
  const organisationId = org.id;
  createdOrg = organisationId;
  data(
    await admin
      .from('organisations')
      .update({ is_test: true })
      .eq('id', organisationId)
      .select('id')
      .single(),
  );
  for (const persona of ['customer'])
    data(
      await admin
        .from('organisation_members')
        .insert({ organisation_id: organisationId, user_id: personas[persona].id, role: 'customer' })
        .select('user_id')
        .single(),
    );
  const catalogue = JSON.parse(
    await readFile(path.join(root, 'fixtures/boreal-living/catalogue.json'), 'utf8'),
  );
  const products = [];
  const variantRows = [];
  for (const item of catalogue.products) {
    const { fixtureImage, ...input } = item;
    const id = data(
      await admin.rpc('catalogue_product_write', {
        p_org_id: organisationId,
        p_actor_id: personas.retailer.id,
        p_product_id: null,
        p_product: {
          ...input,
          variants: [
            {
              sku: input.sku,
              name: 'Standard',
              priceMinor: input.priceMinor,
              dimensions: input.dimensions,
              color: input.color,
              material: input.material,
              active: input.active,
              availability: input.availability,
              stockQuantity: input.stockQuantity,
              leadTimeDays: input.leadTimeDays,
            },
          ],
        },
      }),
    );
    const rows = data(await admin.from('product_variants').select('*').eq('product_id', id));
    products.push({ id, variantIds: rows.map((row) => row.id), sku: input.sku });
    variantRows.push({ ...input, id, variant: rows[0], fixtureImage });
  }
  const contact = data(
    await admin
      .from('customers')
      .insert({
        organisation_id: organisationId,
        name: 'Maya — Fictional Customer',
        email: personas.customer.email,
        notes: 'Synthetic contact created for the authorised Boreal Living test scenario.',
      })
      .select('id')
      .single(),
  );
  const room = {
    name: 'Maya’s fictional measured bedroom',
    width: 6,
    depth: 5,
    height: 2.7,
    measurementsConfirmed: true,
    zones: [],
    openings: [
      {
        id: randomUUID(),
        name: 'Fictional bedroom window',
        kind: 'window',
        wall: 'west',
        offset: 0.6,
        width: 1.2,
        height: 1.2,
        sillHeight: 1,
        clearanceDepth: 0.4,
      },
      {
        id: randomUUID(),
        name: 'Fictional bedroom door',
        kind: 'door',
        wall: 'south',
        offset: 0.1,
        width: 0.9,
        height: 2.1,
        sillHeight: 0,
        clearanceDepth: 0.9,
      },
    ],
  };
  const scene = {
    schemaVersion: 2,
    id: randomUUID(),
    organisationId,
    version: 0,
    room,
    objects: [],
    groups: [],
  };
  const bundle = data(
    await admin.rpc('create_project', {
      p_org_id: organisationId,
      p_actor_id: personas.retailer.id,
      p_customer_id: contact.id,
      p_name: 'Maya’s bedroom — fictional customer consultation',
      p_budget_minor: 240000,
      p_currency: 'EUR',
      p_style: 'Warm Scandinavian oak',
      p_room_type: 'bedroom',
      p_scene: scene,
    }),
  );
  const projectId = bundle.project.id;
  data(
    await owner.rpc('grant_project_access', {
      p_org_id: organisationId,
      p_project_id: projectId,
      p_user_id: personas.customer.id,
      p_can_edit: true,
      p_can_order: true,
    }),
  );
  data(
    await admin.rpc('set_retailer_pricing_policy', {
      p_org_id: organisationId,
      p_actor_id: personas.retailer.id,
      p_expected_revision: 0,
      p_policy: {
        version: 1,
        currency: 'EUR',
        taxMode: 'exclusive',
        taxRateBps: 1800,
        rounding: 'invoice',
        discountBps: 0,
        deliveryMinor: 6000,
        installationMinor: 0,
        feesTaxable: true,
      },
    }),
  );
  const token = randomBytes(32).toString('base64url'),
    nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('roomsell:inventory:v1:' + organisationId));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const envelope =
    'v1.' +
    nonce.toString('base64url') +
    '.' +
    cipher.getAuthTag().toString('base64url') +
    '.' +
    encrypted.toString('base64url');
  const connection = data(
    await admin.rpc('inventory_connection_write', {
      p_org_id: organisationId,
      p_actor_id: personas.retailer.id,
      p_connection_id: null,
      p_expected_revision: null,
      p_config: {
        name: 'Boreal Living — SIMULATED inventory',
        endpoint: 'https://inventory.boreal-living.test/snapshot',
        orderEndpoint: 'https://inventory.boreal-living.test/fulfilments',
        enabled: true,
      },
      p_token_envelope: envelope,
    }),
  );
  const mappings = variantRows.map((item) => ({
    externalProductId: item.sku,
    externalVariantId: item.variant.sku,
    productId: item.id,
    variantId: item.variant.id,
  }));
  data(
    await admin.rpc('inventory_replace_mappings', {
      p_org_id: organisationId,
      p_actor_id: personas.retailer.id,
      p_connection_id: connection.id,
      p_expected_revision: connection.revision,
      p_mappings: mappings,
    }),
  );
  const stock = {
    schemaVersion: 1,
    items: variantRows.map((item) => ({
      externalProductId: item.sku,
      externalVariantId: item.variant.sku,
      sku: item.variant.sku,
      currency: 'EUR',
      priceMinor: Number(item.variant.price_minor),
      stockQuantity: item.variant.stock_quantity,
      availability: item.variant.availability,
    })),
  };
  const profile = {
    version: 1,
    organisationId,
    projectId,
    connectionId: connection.id,
    providerTokenHash: createHash('sha256').update(token).digest('hex'),
    personas,
    products,
  };
  // Use the ordinary authenticated HTTP preview/accept path for all furniture.
  const cookies = new Map();
  async function request(route, options = {}) {
    const response = await fetch(new URL(route, base), {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Cookie: [...cookies].map(([name, value]) => name + '=' + value).join('; '),
        ...options.headers,
      },
    });
    for (const header of response.headers.getSetCookie()) {
      const first = header.split(';')[0],
        split = first.indexOf('=');
      cookies.set(first.slice(0, split), first.slice(split + 1));
    }
    if (!response.ok)
      throw new Error('Fixture HTTP operation failed at ' + route + ' (' + response.status + ')');
    return response.json();
  }
  await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: personas.retailer.email, password: personas.retailer.password }),
  });
  const placements = [
    ['BL-ASTER', 3, 1.3, 0],
    ['BL-FJORD', 5.5, 3.2, Math.PI / 2],
    ['BL-PINE', 1.8, 0.8, 0],
    ['BL-PINE', 4.2, 0.8, 0],
    ['BL-MIRA', 3, 1.8, 0],
    ['BL-COVE', 1, 3, 0],
  ];
  for (const [sku, x, z, rotation] of placements) {
    const item = variantRows.find((row) => row.sku === sku),
      variant = item.variant;
    const state = await request('/api/projects/' + projectId + '/scene');
    const preview = await request('/api/projects/' + projectId + '/scene', {
      method: 'POST',
      body: JSON.stringify({
        action: 'preview',
        expectedVersion: state.scene.version,
        operation: {
          type: 'add-object',
          object: {
            id: randomUUID(),
            sku: variant.sku,
            variantId: variant.id,
            name: item.name,
            category: item.category,
            dimensions: item.dimensions,
            color: item.color,
            solid: item.category !== 'rug',
            transform: { x, y: 0, z, rotation },
            locks: {
              position: sku === 'BL-FJORD',
              rotation: sku === 'BL-FJORD',
              product: sku === 'BL-FJORD',
            },
          },
        },
      }),
    });
    await request('/api/projects/' + projectId + '/scene', {
      method: 'POST',
      body: JSON.stringify({
        action: 'accept',
        expectedVersion: state.scene.version,
        proposalId: preview.proposal.id,
      }),
    });
  }
  for (const item of variantRows) {
    if (!item.fixtureImage) continue;
    let bytes;
    try {
      bytes = await readFile(path.join(root, 'fixtures/boreal-living/images', item.fixtureImage));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const form = new FormData();
    form.set('file', new File([bytes], item.fixtureImage, { type: 'image/png' }));
    await request('/api/organisations/' + organisationId + '/catalogue/' + item.id + '/assets', {
      method: 'POST',
      body: form,
    });
  }
  try {
    const roomBytes = await readFile(path.join(root, 'fixtures/boreal-living/images/room.png'));
    const form = new FormData();
    form.set('file', new File([roomBytes], 'Boreal Living fictional bedroom.png', { type: 'image/png' }));
    await request('/api/projects/' + projectId + '/references', { method: 'POST', body: form });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Publication is explicit and restricted to this authorised fictional fixture.
  for (const item of variantRows) {
    const assets = data(
      await admin
        .from('product_assets')
        .select('id')
        .eq('product_id', item.id)
        .eq('kind', 'image')
        .eq('status', 'validated'),
    );
    await request('/api/organisations/' + organisationId + '/publications', {
      method: 'PUT',
      body: JSON.stringify({
        variantId: item.variant.id,
        expectedRevision: 0,
        enabled: true,
        imageIds: assets.map((asset) => asset.id).slice(0, 4),
      }),
    });
  }
  await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: personas.consumer.email, password: personas.consumer.password }),
  });
  const personal = await request('/api/consumer/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Leo’s private fictional bedroom',
      currency: 'EUR',
      budgetMinor: 180000,
      room: { ...room, name: 'Leo’s fictional measured bedroom' },
    }),
  });
  profile.consumerProjectId = personal.id;
  await writeFile(path.join(directory, 'boreal-stock.json'), JSON.stringify(stock), { mode: 0o600 });
  const temporary = profilePath + '.' + randomUUID();
  await writeFile(temporary, JSON.stringify(profile), { mode: 0o600 });
  await rename(temporary, profilePath);
  console.log(
    'Fictional Boreal Living retailer, personas, measured project and simulated inventory prepared. Open /testing. No real retailer data was changed.',
  );
} catch (error) {
  if (createdOrg) await admin.from('organisations').delete().eq('id', createdOrg);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  throw error;
}
