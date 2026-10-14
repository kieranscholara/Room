import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { CatalogueProduct, ProductInput } from '@roomsell/catalogue';
import type { SceneObject } from '@roomsell/scene-core';

const measuredRoom = {
  name: 'Measured catalogue bedroom',
  width: 6,
  depth: 5,
  height: 2.7,
  measurementsConfirmed: true,
  zones: [],
  openings: [],
};
const csvHeader =
  'product_sku,variant_sku,product_name,variant_name,category,price_minor,currency,width_m,depth_m,height_m,color,material,availability,stock_quantity,lead_time_days,active';

async function register(client: APIRequestContext) {
  const response = await client.post('/api/auth/signup', {
    data: {
      email: `catalogue-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName: 'Catalogue tester',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user as { id: string; email: string };
}
async function organisation(client: APIRequestContext) {
  const response = await client.post('/api/organisations', {
    data: { name: `Catalogue ${randomUUID().slice(0, 8)}`, currency: 'EUR' },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}
async function invite(
  owner: APIRequestContext,
  client: APIRequestContext,
  organisationId: string,
  person: { email: string },
  role: string,
) {
  const invitation = await owner.post(`/api/organisations/${organisationId}/invitations`, {
    data: { email: person.email, role },
  });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get('token');
  expect((await client.post('/api/invitations/accept', { data: { token } })).status()).toBe(200);
}
function productInput(sku = `TEST-${randomUUID().slice(0, 8)}`): ProductInput {
  return {
    sku,
    name: 'Measured oak bed',
    category: 'bed',
    currency: 'EUR',
    priceMinor: 125000,
    dimensions: { width: 1.6, depth: 2, height: 1 },
    color: '#112233',
    material: 'Oak',
    active: true,
    availability: 'in_stock',
    stockQuantity: 3,
    leadTimeDays: 7,
    variants: [],
  };
}
async function createProduct(client: APIRequestContext, organisationId: string, input = productInput()) {
  const response = await client.post(`/api/organisations/${organisationId}/catalogue`, { data: input });
  expect(response.status()).toBe(201);
  return (await response.json()) as CatalogueProduct;
}
function updateInput(product: CatalogueProduct): ProductInput {
  const {
    sku,
    name,
    category,
    currency,
    priceMinor,
    dimensions,
    color,
    material,
    active,
    availability,
    stockQuantity,
    leadTimeDays,
  } = product;
  return {
    sku,
    name,
    category,
    currency,
    priceMinor,
    dimensions,
    color,
    material,
    active,
    availability,
    stockQuantity,
    leadTimeDays,
    variants: product.variants.map(
      ({
        id,
        sku,
        name,
        priceMinor,
        dimensions,
        color,
        material,
        active,
        availability,
        stockQuantity,
        leadTimeDays,
      }) => ({
        id,
        sku,
        name,
        priceMinor,
        dimensions,
        color,
        material,
        active,
        availability,
        stockQuantity,
        leadTimeDays,
      }),
    ),
  };
}
function catalogueObject(product: CatalogueProduct): SceneObject {
  const variant = product.variants[0];
  return {
    id: randomUUID(),
    variantId: variant.id,
    sku: variant.sku,
    name: product.name,
    category: product.category,
    dimensions: variant.dimensions,
    color: variant.color,
    solid: product.category !== 'rug',
    transform: { x: 3, y: 0, z: 2.5, rotation: 0 },
    locks: { position: false, rotation: false, product: false },
  };
}
async function createProject(client: APIRequestContext, organisationId: string) {
  const response = await client.post(`/api/organisations/${organisationId}/projects`, {
    data: {
      name: 'Catalogue acceptance bedroom',
      customerId: null,
      budgetMinor: 500000,
      currency: 'EUR',
      style: 'Natural',
      roomType: 'bedroom',
      room: measuredRoom,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}
async function preview(client: APIRequestContext, projectId: string, object: SceneObject) {
  return client.post(`/api/projects/${projectId}/scene`, {
    data: { action: 'preview', expectedVersion: 0, operation: { type: 'add-object', object } },
  });
}
async function accept(client: APIRequestContext, projectId: string, proposalId: string) {
  return client.post(`/api/projects/${projectId}/scene`, {
    data: { action: 'accept', expectedVersion: 0, proposalId },
  });
}
function csvRow(productSku: string, variantSku: string, price = '125000') {
  return `${productSku},${variantSku},Imported Bed,Oak,bed,${price},EUR,1.6,2,1,#112233,Oak,in_stock,3,7,true`;
}
async function importCsv(client: APIRequestContext, organisationId: string, rows: string[]) {
  return client.post(`/api/organisations/${organisationId}/catalogue/import`, {
    multipart: {
      file: {
        name: 'catalogue.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from([csvHeader, ...rows].join('\n')),
      },
    },
  });
}

test('catalogue writes and private assets enforce tenant and staff roles', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(120000);
  const owner = await playwright.request.newContext({ baseURL }),
    foreign = await playwright.request.newContext({ baseURL }),
    salesperson = await playwright.request.newContext({ baseURL }),
    customer = await playwright.request.newContext({ baseURL }),
    anonymous = await playwright.request.newContext({ baseURL });
  try {
    await register(owner);
    await register(foreign);
    const salesUser = await register(salesperson),
      customerUser = await register(customer),
      org = await organisation(owner),
      otherOrg = await organisation(foreign);
    await invite(owner, salesperson, org.id, salesUser, 'salesperson');
    await invite(owner, customer, org.id, customerUser, 'customer');
    const product = await createProduct(owner, org.id),
      foreignProduct = await createProduct(foreign, otherOrg.id);
    const catalogue = `/api/organisations/${org.id}/catalogue`,
      productPath = `${catalogue}/${product.id}`;
    expect((await anonymous.get(catalogue)).status()).toBe(401);
    expect((await foreign.get(catalogue)).status()).toBe(403);
    expect((await customer.get(catalogue)).status()).toBe(403);
    expect((await salesperson.get(catalogue)).status()).toBe(200);
    const bySku = await salesperson.get(
      `${catalogue}?q=${encodeURIComponent(product.sku)}&category=bed&active=true`,
    );
    expect(bySku.status()).toBe(200);
    expect((await bySku.json()).map((entry: CatalogueProduct) => entry.id)).toEqual([product.id]);
    expect(
      await (await salesperson.get(`${catalogue}?q=${encodeURIComponent(product.sku)}&category=desk`)).json(),
    ).toEqual([]);
    expect(
      await (await salesperson.get(`${catalogue}?q=${encodeURIComponent(product.sku)}&active=false`)).json(),
    ).toEqual([]);
    const hostileQuery = await salesperson.get(`${catalogue}?q=${encodeURIComponent('",sku.eq.%_')}`);
    expect(hostileQuery.status()).toBe(200);
    expect(await hostileQuery.json()).toEqual([]);
    expect((await salesperson.post(catalogue, { data: productInput() })).status()).toBe(403);
    expect((await salesperson.patch(productPath, { data: updateInput(product) })).status()).toBe(403);
    expect((await foreign.delete(productPath)).status()).toBe(403);
    expect(
      (
        await owner.patch(`${catalogue}/${foreignProduct.id}`, { data: updateInput(foreignProduct) })
      ).status(),
    ).toBe(404);
    expect(
      (await owner.post(catalogue, { data: { ...productInput(), organisationId: otherOrg.id } })).status(),
    ).toBe(400);
    expect(
      (
        await owner.post(catalogue, {
          data: productInput(),
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status(),
    ).toBe(403);

    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#112233' } })
      .png()
      .toBuffer();
    const upload = { multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: png } } };
    expect((await salesperson.post(`${productPath}/assets`, upload)).status()).toBe(403);
    expect((await foreign.post(`${productPath}/assets`, upload)).status()).toBe(403);
    expect(
      (
        await owner.post(`${productPath}/assets`, {
          multipart: { variantId: foreignProduct.variants[0].id, file: upload.multipart.file },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await owner.post(`${productPath}/assets`, {
          multipart: {
            file: {
              name: 'spoof.png',
              mimeType: 'image/png',
              buffer: Buffer.from('<svg onload="alert(1)"></svg>'),
            },
          },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await owner.post(`${productPath}/assets`, {
          multipart: {
            file: { name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('glTF-invalid') },
          },
        })
      ).status(),
    ).toBe(422);
    const externalModel = Buffer.from(
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'https://untrusted.example/mesh.bin', byteLength: 36 }],
      }),
    );
    expect(
      (
        await owner.post(`${productPath}/assets`, {
          multipart: { file: { name: 'external.gltf', mimeType: 'model/gltf+json', buffer: externalModel } },
        })
      ).status(),
    ).toBe(422);
    const added = await owner.post(`${productPath}/assets`, upload);
    expect(added.status()).toBe(201);
    const asset = (await added.json()) as { id: string; url: string };
    expect((await owner.get(asset.url)).status()).toBe(200);
    expect((await salesperson.get(asset.url)).status()).toBe(200);
    expect((await foreign.get(asset.url)).status()).toBe(403);
    expect((await customer.get(asset.url)).status()).toBe(403);
    expect((await anonymous.get(asset.url)).status()).toBe(401);
    expect((await owner.delete(`${productPath}/assets/${asset.id}`)).status()).toBe(200);
    expect((await owner.get(asset.url)).status()).toBe(404);
  } finally {
    await Promise.all([
      owner.dispose(),
      foreign.dispose(),
      salesperson.dispose(),
      customer.dispose(),
      anonymous.dispose(),
    ]);
  }
});

test('CSV row failures and duplicate SKUs leave the complete import unchanged', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(90000);
  const owner = await playwright.request.newContext({ baseURL });
  try {
    await register(owner);
    const org = await organisation(owner),
      existing = await createProduct(owner, org.id),
      prefix = `CSV-${randomUUID().slice(0, 8)}`,
      catalogue = `/api/organisations/${org.id}/catalogue`;
    const invalid = await importCsv(owner, org.id, [
      csvRow(`${prefix}-A`, `${prefix}-V1`),
      csvRow(`${prefix}-B`, `${prefix}-V2`, '-1'),
    ]);
    expect(invalid.status()).toBe(422);
    const invalidResult = await invalid.json();
    expect(invalidResult.status).toBe('failed');
    expect(invalidResult.summary.errors).toContainEqual(
      expect.objectContaining({ row: 3, field: 'price_minor' }),
    );
    expect(
      (await (await owner.get(catalogue)).json()).map((product: CatalogueProduct) => product.id),
    ).toEqual([existing.id]);
    const duplicate = await importCsv(owner, org.id, [
      csvRow(`${prefix}-A`, `${prefix}-V1`),
      csvRow(existing.sku, `${prefix}-V2`),
    ]);
    expect(duplicate.status()).toBe(422);
    expect(JSON.stringify(await duplicate.json())).toMatch(/already exists|duplicate/i);
    expect(
      (await (await owner.get(catalogue)).json()).map((product: CatalogueProduct) => product.id),
    ).toEqual([existing.id]);
    const completed = await importCsv(owner, org.id, [csvRow(`${prefix}-A`, `${prefix}-V1`)]);
    expect(completed.status()).toBe(200);
    expect(await completed.json()).toMatchObject({
      status: 'completed',
      summary: { rowCount: 1, productCount: 1, variantCount: 1, errors: [] },
    });
    const history = await owner.get(`${catalogue}/import`);
    expect(history.status()).toBe(200);
    expect((await history.json()).map((row: { status: string }) => row.status).sort()).toEqual([
      'completed',
      'failed',
      'failed',
    ]);
    const rows = (await (await owner.get(catalogue)).json()) as CatalogueProduct[];
    expect(rows).toHaveLength(2);
    expect(rows.find((product) => product.sku === `${prefix}-A`)?.variants[0]).toMatchObject({
      sku: `${prefix}-V1`,
      priceMinor: 125000,
      dimensions: { width: 1.6, depth: 2, height: 1 },
    });
  } finally {
    await owner.dispose();
  }
});

test('scene additions reject forged catalogue metadata and recheck changed products at acceptance', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(90000);
  const owner = await playwright.request.newContext({ baseURL }),
    foreign = await playwright.request.newContext({ baseURL });
  try {
    await register(owner);
    await register(foreign);
    const org = await organisation(owner),
      otherOrg = await organisation(foreign),
      product = await createProduct(owner, org.id),
      foreignProduct = await createProduct(foreign, otherOrg.id),
      project = await createProject(owner, org.id),
      object = catalogueObject(product),
      productPath = `/api/organisations/${org.id}/catalogue/${product.id}`;
    expect((await preview(owner, project.id, { ...object, sku: 'INVENTED-SKU' })).status()).toBe(409);
    expect(
      (
        await preview(owner, project.id, { ...object, dimensions: { ...object.dimensions, width: 0.8 } })
      ).status(),
    ).toBe(409);
    expect(
      (await preview(owner, project.id, { ...object, variantId: foreignProduct.variants[0].id })).status(),
    ).toBe(422);
    const pending = await preview(owner, project.id, object);
    expect(pending.status()).toBe(200);
    const proposal = (await pending.json()).proposal;
    const dimensionsChanged = updateInput(product);
    dimensionsChanged.variants[0].dimensions = { ...object.dimensions, width: 1.8 };
    expect((await owner.patch(productPath, { data: dimensionsChanged })).status()).toBe(200);
    expect((await accept(owner, project.id, proposal.id)).status()).toBe(409);
    expect((await (await owner.get(`/api/projects/${project.id}/scene`)).json()).scene.objects).toEqual([]);
    const restored = await owner.patch(productPath, { data: updateInput(product) });
    expect(restored.status()).toBe(200);
    const beforeArchive = await preview(owner, project.id, object);
    expect(beforeArchive.status()).toBe(200);
    expect((await owner.delete(productPath)).status()).toBe(200);
    expect((await accept(owner, project.id, (await beforeArchive.json()).proposal.id)).status()).toBe(422);
    const saved = (await (await owner.get(`/api/projects/${project.id}/scene`)).json()).scene;
    expect(saved.version).toBe(0);
    expect(saved.objects).toEqual([]);
  } finally {
    await Promise.all([owner.dispose(), foreign.dispose()]);
  }
});

test('selected project prices stay authoritative and shared customers see only selected product assets', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(90000);
  const owner = await playwright.request.newContext({ baseURL }),
    customer = await playwright.request.newContext({ baseURL }),
    outsider = await playwright.request.newContext({ baseURL });
  try {
    await register(owner);
    const customerUser = await register(customer);
    await register(outsider);
    const org = await organisation(owner);
    await invite(owner, customer, org.id, customerUser, 'customer');
    const selected = await createProduct(owner, org.id),
      unselected = await createProduct(owner, org.id),
      project = await createProject(owner, org.id),
      privateProject = await createProject(owner, org.id),
      object = catalogueObject(selected);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#112233' } })
      .png()
      .toBuffer();
    const upload = { multipart: { file: { name: 'project-photo.png', mimeType: 'image/png', buffer: png } } };
    const selectedUpload = await owner.post(
      `/api/organisations/${org.id}/catalogue/${selected.id}/assets`,
      upload,
    );
    expect(selectedUpload.status()).toBe(201);
    const selectedAsset = (await selectedUpload.json()) as { id: string };
    const unselectedUpload = await owner.post(
      `/api/organisations/${org.id}/catalogue/${unselected.id}/assets`,
      upload,
    );
    expect(unselectedUpload.status()).toBe(201);
    const unselectedAsset = (await unselectedUpload.json()) as { id: string };
    const pending = await preview(owner, project.id, object);
    expect(pending.status()).toBe(200);
    const priceChanged = updateInput(selected);
    priceChanged.priceMinor = 150000;
    priceChanged.variants[0].priceMinor = 150000;
    expect(
      (
        await owner.patch(`/api/organisations/${org.id}/catalogue/${selected.id}`, { data: priceChanged })
      ).status(),
    ).toBe(200);
    const accepted = await accept(owner, project.id, (await pending.json()).proposal.id);
    expect(accepted.status()).toBe(200);
    expect(
      (
        await owner.post(`/api/projects/${project.id}/access`, {
          data: { userId: customerUser.id, canEdit: false },
        })
      ).status(),
    ).toBe(200);
    expect((await customer.get(`/api/organisations/${org.id}/catalogue`)).status()).toBe(403);
    expect((await customer.get(`/api/projects/${privateProject.id}/products`)).status()).toBe(404);
    expect((await outsider.get(`/api/projects/${project.id}/products`)).status()).toBe(404);
    const pricing = await customer.get(
      `/api/projects/${project.id}/products?variantId=${unselected.variants[0].id}`,
    );
    expect(pricing.status()).toBe(200);
    const data = await pricing.json();
    expect(data).toMatchObject({
      currency: 'EUR',
      totalMinor: 150000,
      budgetMinor: 500000,
      overBudget: false,
      stale: false,
    });
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      objectId: object.id,
      variantId: selected.variants[0].id,
      priceMinor: 150000,
    });
    expect(data.items[0].assets.map((asset: { id: string }) => asset.id)).toEqual([selectedAsset.id]);
    expect((await customer.get(`/api/projects/${project.id}/assets/${selectedAsset.id}`)).status()).toBe(200);
    expect((await outsider.get(`/api/projects/${project.id}/assets/${selectedAsset.id}`)).status()).toBe(404);
    expect((await customer.get(`/api/projects/${project.id}/assets/${unselectedAsset.id}`)).status()).toBe(
      404,
    );
    const dimensionsChanged = {
      ...priceChanged,
      variants: [{ ...priceChanged.variants[0], dimensions: { ...object.dimensions, width: 1.8 } }],
    };
    expect(
      (
        await owner.patch(`/api/organisations/${org.id}/catalogue/${selected.id}`, {
          data: dimensionsChanged,
        })
      ).status(),
    ).toBe(200);
    const stale = await (await customer.get(`/api/projects/${project.id}/products`)).json();
    expect(stale).toMatchObject({ stale: true, totalMinor: 150000 });
    expect(stale.items[0].stale).toBe(true);
    const preserved = await (await customer.get(`/api/projects/${project.id}/scene`)).json();
    expect(preserved.scene.objects[0].dimensions).toEqual(object.dimensions);
    expect(
      (await owner.delete(`/api/projects/${project.id}/access?userId=${customerUser.id}`)).status(),
    ).toBe(200);
    expect((await customer.get(`/api/projects/${project.id}/products`)).status()).toBe(404);
    expect((await customer.get(`/api/projects/${project.id}/assets/${selectedAsset.id}`)).status()).toBe(404);
  } finally {
    await Promise.all([owner.dispose(), customer.dispose(), outsider.dispose()]);
  }
});
