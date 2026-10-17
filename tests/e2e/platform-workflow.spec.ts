import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Scene } from '@roomsell/scene-core';
import {
  calibratePhotoInBrowser,
  confirmPhotoDesign,
  uploadCalibratedPhoto,
  runPhotoJob,
} from './photo-helpers';
test.setTimeout(180000);
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});
async function fixture() {
  return JSON.parse(await readFile('.local/e2e-fixtures/boreal.json', 'utf8')) as {
    organisationId: string;
    projectId: string;
    connectionId: string;
    personas: { customer: { id: string } };
  };
}
async function enter(page: Page, persona: string) {
  await page.goto('/testing');
  await page.getByRole('button', { name: 'Enter as ' + persona, exact: true }).click();
  await page.waitForURL(
    persona === 'retailer' ? '**/workspace?**' : persona === 'customer' ? '**/projects/**' : '**/marketplace',
  );
}
async function get(request: APIRequestContext, url: string) {
  const r = await request.get(url);
  expect(r.status(), url).toBe(200);
  return r.json();
}
async function createProject(page: Page) {
  const f = await fixture(),
    source = await get(page.request, `/api/projects/${f.projectId}/scene`);
  // Browser fixtures are separate from the interactive company. Restock this
  // disposable upstream through its normal guarded API so reruns do not exhaust it.
  const catalogue = JSON.parse(await readFile('fixtures/boreal-living/catalogue.json', 'utf8')) as {
    products: { sku: string; stockQuantity: number; availability: string }[];
  };
  for (const item of catalogue.products) {
    expect(
      (
        await page.request.post('/api/testing/inventory', {
          data: {
            externalVariantId: item.sku,
            stockQuantity: item.stockQuantity,
            availability: item.availability,
          },
        })
      ).status(),
    ).toBe(200);
  }
  const connections = await get(page.request, `/api/organisations/${f.organisationId}/inventory`);
  const configured = connections.connections.find((item: { id: string }) => item.id === f.connectionId);
  expect(
    (
      await page.request.post(`/api/organisations/${f.organisationId}/inventory/${f.connectionId}/sync`, {
        data: { expectedRevision: configured.revision },
      })
    ).status(),
  ).toBe(200);
  const response = await page.request.post(`/api/organisations/${f.organisationId}/projects`, {
    data: {
      name: 'Browser customer test ' + randomUUID().slice(0, 8),
      customerId: null,
      budgetMinor: 1000000,
      currency: 'EUR',
      style: '',
      roomType: 'bedroom',
      room: source.scene.room,
    },
  });
  expect(response.status()).toBe(201);
  const p = await response.json();
  for (const original of source.scene.objects) {
    const state = await get(page.request, `/api/projects/${p.id}/scene`);
    const preview = await page.request.post(`/api/projects/${p.id}/scene`, {
      data: {
        action: 'preview',
        expectedVersion: state.scene.version,
        operation: { type: 'add-object', object: { ...original, id: randomUUID() } },
      },
    });
    expect(preview.status()).toBe(200);
    const proposed = await preview.json();
    expect(
      (
        await page.request.post(`/api/projects/${p.id}/scene`, {
          data: { action: 'accept', expectedVersion: state.scene.version, proposalId: proposed.proposal.id },
        })
      ).status(),
    ).toBe(200);
  }
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/access`, {
        data: { userId: f.personas.customer.id, canEdit: true, canOrder: true },
      })
    ).status(),
  ).toBe(200);
  return { f, p, source };
}

test('fictional retailer uploads a private room photo, reviews assistance and fulfils a customer order', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enter(page, 'retailer');
  const { f, p } = await createProject(page);
  await page.goto(`/projects/${p.id}`);
  await expect(page.getByLabel('AI provider', { exact: true })).toHaveValue('test');
  const before = (await get(page.request, `/api/projects/${p.id}/scene`)).scene as Scene;
  const locked = before.objects.find((x) => x.locks.position)!;
  await calibratePhotoInBrowser(page, p.id);
  const photos = await get(page.request, `/api/projects/${p.id}/references`);
  expect(photos).toHaveLength(1);
  expect((await page.request.get(photos[0].url)).headers()['content-type']).toBe('image/png');
  await page.getByRole('button', { name: 'Request design assistance', exact: true }).click();
  await expect(page.getByText('Assistance job: queued', { exact: true })).toBeVisible();
  await runPhotoJob(page);
  await expect(page.getByRole('region', { name: 'Design assistance result' })).toContainText(
    'not generated by OpenAI',
  );
  const queued = await get(page.request, `/api/projects/${p.id}/jobs`);
  expect(queued[0].status).toBe('completed');
  expect((await get(page.request, `/api/projects/${p.id}/scene`)).scene).toEqual(before);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Design assistance result' })).toContainText(
    'not generated by OpenAI',
  );
  await page.getByRole('button', { name: 'Review suggested layout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview', exact: true })).not.toBeVisible();
  const after = (await get(page.request, `/api/projects/${p.id}/scene`)).scene as Scene;
  expect(after.version).toBe(before.version + 1);
  expect(after.objects.find((x) => x.id === locked.id)).toEqual(locked);
  await confirmPhotoDesign(page);
  await page.getByRole('button', { name: 'Review quotation', exact: true }).click();
  await page.getByRole('button', { name: 'Issue reviewed quotation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Issued quotation details' })).toBeVisible();
  const quotes = await get(page.request, `/api/projects/${p.id}/quotations`);
  expect(quotes).toHaveLength(1);
  await enter(page, 'customer');
  await page.goto(`/projects/${p.id}`);
  await page.getByText('Orders and customer access', { exact: true }).click();
  await page.getByRole('button', { name: 'Reserve quotation stock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm order', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm order', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project orders' })).toContainText('confirmed');
  let orders = await get(page.request, `/api/projects/${p.id}/orders`);
  expect(orders.orders[0].snapshot).toEqual(quotes[0].snapshot);
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/orders/${orders.orders[0].id}`, {
        data: { action: 'fulfil', expectedStatus: 'confirmed' },
      })
    ).status(),
  ).toBe(403);
  await enter(page, 'retailer');
  await page.goto(`/projects/${p.id}`);
  await page.getByText('Orders and customer access', { exact: true }).click();
  await page.getByRole('button', { name: 'Record fulfilment', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project orders' })).toContainText('fulfilled');
  await expect(page.getByRole('region', { name: 'Project orders' })).toContainText(
    'Supplier accepted: BOREAL-',
  );
  const fulfilled = await get(page.request, `/api/projects/${p.id}/orders`);
  const retry = await page.request.post(`/api/projects/${p.id}/orders/${fulfilled.orders[0].id}`, {
    data: { action: 'fulfil', expectedStatus: 'confirmed' },
  });
  expect(retry.status()).toBe(200);
  expect((await retry.json()).status).toBe('fulfilled');
  const selectedBefore = await get(page.request, `/api/projects/${p.id}/products`);
  const overview = await get(page.request, `/api/organisations/${f.organisationId}/inventory`),
    connection = overview.connections.find((c: { id: string }) => c.id === f.connectionId);
  const job = await page.request.post(`/api/organisations/${f.organisationId}/jobs`, {
    data: {
      kind: 'inventory_sync',
      connectionId: f.connectionId,
      expectedRevision: connection.revision,
      idempotencyKey: randomUUID(),
    },
  });
  expect(job.status()).toBe(202);
  const jobId = (await job.json()).id;
  await runPhotoJob(page, jobId);
  expect((await get(page.request, `/api/jobs/${jobId}`)).status).toBe('completed');
  expect(
    (await get(page.request, `/api/projects/${p.id}/products`)).items.map(
      (i: { stockQuantity: number }) => i.stockQuantity,
    ),
  ).toEqual(selectedBefore.items.map((i: { stockQuantity: number }) => i.stockQuantity));
  orders = await get(page.request, `/api/projects/${p.id}/orders`);
  expect(orders.orders[0].status).toBe('fulfilled');
  await page.screenshot({ path: 'test-results/boreal-retailer.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('a fictional supplier decline keeps stock intact and allows the retailer to cancel', async ({
  page,
}) => {
  await enter(page, 'retailer');
  const { p } = await createProject(page);
  await uploadCalibratedPhoto(page.request, p.id);
  await page.goto(`/projects/${p.id}`);
  await confirmPhotoDesign(page);
  await page.getByRole('button', { name: 'Review quotation', exact: true }).click();
  await page.getByRole('button', { name: 'Issue reviewed quotation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Issued quotation details' })).toBeVisible();
  const quotes = await get(page.request, `/api/projects/${p.id}/quotations`);
  const reserved = await page.request.post(`/api/projects/${p.id}/orders`, {
    data: { quotationId: quotes[0].id, idempotencyKey: randomUUID() },
  });
  expect(reserved.status()).toBe(201);
  const order = await reserved.json();
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/orders/${order.id}`, {
        data: { action: 'confirm', expectedStatus: 'reserved' },
      })
    ).status(),
  ).toBe(200);
  const stockBefore = await get(page.request, `/api/projects/${p.id}/products`);
  const upstream = (await get(page.request, '/api/testing/inventory')).items.find(
    (item: { sku: string }) => item.sku === 'BL-ASTER',
  );
  try {
    expect(
      (
        await page.request.post('/api/testing/inventory', {
          data: {
            externalVariantId: upstream.externalVariantId,
            stockQuantity: 0,
            availability: 'out_of_stock',
          },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await page.getByText('Orders and customer access', { exact: true }).click();
    await page.getByRole('button', { name: 'Record fulfilment', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Project orders' });
    await expect(panel).toContainText('Supplier rejected: BOREAL-');
    await expect(panel.getByRole('alert')).toContainText('supplier declined');
    await expect(page.getByRole('button', { name: 'Record fulfilment', exact: true })).toHaveCount(0);
    expect(
      (await get(page.request, `/api/projects/${p.id}/products`)).items.map(
        (item: { stockQuantity: number }) => item.stockQuantity,
      ),
    ).toEqual(stockBefore.items.map((item: { stockQuantity: number }) => item.stockQuantity));
    const declined = (await get(page.request, `/api/projects/${p.id}/orders`)).orders[0];
    expect(declined.supplierAcknowledgement.status).toBe('rejected');
    expect(
      (
        await page.request.post(`/api/projects/${p.id}/orders/${order.id}`, {
          data: { action: 'fulfil', expectedStatus: 'confirmed' },
        })
      ).status(),
    ).toBe(422);
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(panel).toContainText('cancelled');
  } finally {
    await page.request.post('/api/testing/inventory', {
      data: {
        externalVariantId: upstream.externalVariantId,
        stockQuantity: upstream.stockQuantity,
        availability: upstream.availability,
      },
    });
  }
});

test('consumer owns a private measured 3D design and explicitly shares a retailer enquiry', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enter(page, 'consumer');
  const f = await fixture();
  const offers = await get(page.request, '/api/marketplace/offers');
  const offer = offers.find(
    (o: { organisationId: string; category: string; available: boolean }) =>
      o.organisationId === f.organisationId && o.category === 'bedside' && o.available,
  );
  expect(offer.fictional).toBe(true);
  expect(offer.images.length).toBeGreaterThan(0);
  const response = await page.request.post('/api/consumer/projects', {
    data: {
      name: 'Private browser design ' + randomUUID().slice(0, 8),
      currency: 'EUR',
      budgetMinor: 200000,
      room: {
        name: 'Confirmed personal room',
        width: 6,
        depth: 5,
        height: 2.7,
        measurementsConfirmed: true,
        openings: [],
        zones: [],
      },
    },
  });
  expect(response.status()).toBe(201);
  const p = await response.json();
  await page.goto(`/designs/${p.id}?offer=${offer.id}`);
  await expect(page.getByText('Private personal design', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview published furniture', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview', exact: true })).not.toBeVisible();
  const saved = (await get(page.request, `/api/consumer/projects/${p.id}/scene`)).scene;
  expect(saved.objects).toHaveLength(1);
  expect(saved.objects[0].sku).toBe(offer.sku);
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('3D dimension and model status')).toContainText('1');
  await page.reload();
  expect((await get(page.request, `/api/consumer/projects/${p.id}/scene`)).scene).toEqual(saved);
  const button = page.getByRole('button', { name: 'Request quotation from ' + offer.retailer, exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel('I approve sharing these details with the selected retailer.').check();
  await button.click();
  const link = page.getByRole('link', { name: 'Open your shared retailer project', exact: true });
  await expect(link).toBeVisible();
  const sharedPath = await link.getAttribute('href');
  expect(sharedPath).toMatch(/^\/projects\//);
  const retailerScene = (await get(page.request, '/api' + sharedPath + '/scene')).scene;
  expect(retailerScene.objects.map((x: { variantId: string }) => x.variantId)).toEqual([offer.variantId]);
  await page.screenshot({ path: 'test-results/boreal-consumer.png', fullPage: true });
  await enter(page, 'retailer');
  expect((await page.request.get(`/api/consumer/projects/${p.id}/scene`)).status()).toBe(404);
  expect((await page.request.get('/api' + sharedPath + '/scene')).status()).toBe(200);
  await enter(page, 'customer');
  expect((await page.request.get(`/api/consumer/projects/${p.id}`)).status()).toBe(404);
  expect((await page.request.get('/api' + sharedPath + '/scene')).status()).toBe(404);
  expect(errors).toEqual([]);
});

test('unpublishing revokes public image access while private room images and workers require authentication', async ({
  page,
  browser,
}) => {
  await enter(page, 'retailer');
  const f = await fixture(),
    offers = await get(page.request, '/api/marketplace/offers'),
    offer = offers.find(
      (o: { organisationId: string; images: unknown[] }) =>
        o.organisationId === f.organisationId && o.images.length,
    );
  const client = await browser.newContext(),
    anonymous = client.request;
  try {
    expect((await anonymous.get(offer.images[0].url)).status()).toBe(200);
    const privatePhotos = await get(page.request, `/api/projects/${f.projectId}/references`);
    expect((await anonymous.get(privatePhotos[0].url)).status()).toBe(401);
    expect((await anonymous.post('/api/internal/jobs/run')).status()).toBe(401);
    expect(
      (
        await anonymous.post('/api/internal/jobs/run', {
          headers: { Authorization: 'Bearer fake-test-value' },
        })
      ).status(),
    ).toBe(401);
    const path = `/api/organisations/${f.organisationId}/publications`;
    const revoked = await page.request.put(path, {
      data: {
        variantId: offer.variantId,
        expectedRevision: offer.revision,
        enabled: false,
        imageIds: offer.images.map((i: { id: string }) => i.id),
      },
    });
    expect(revoked.status()).toBe(200);
    const row = await revoked.json();
    try {
      expect((await anonymous.get(offer.images[0].url)).status()).toBe(404);
      expect((await anonymous.get('/api/marketplace/offers/' + offer.id)).status()).toBe(404);
    } finally {
      expect(
        (
          await page.request.put(path, {
            data: {
              variantId: offer.variantId,
              expectedRevision: row.revision,
              enabled: true,
              imageIds: offer.images.map((i: { id: string }) => i.id),
            },
          })
        ).status(),
      ).toBe(200);
    }
  } finally {
    await client.close();
  }
});
