import { expect, test, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { calibratePhoto, projectPhotoPoint, type PhotoCalibration } from '@roomsell/geometry';
import type { Scene } from '@roomsell/scene-core';
import { calibratePhotoInBrowser, confirmPhotoDesign, dragPhotoProduct, runPhotoJob } from './photo-helpers';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});
test.setTimeout(180000);
async function get(page: Page, url: string) {
  const r = await page.request.get(url);
  expect(r.status(), url).toBe(200);
  return r.json();
}
async function setup(page: Page) {
  await page.goto('/testing');
  await page.getByRole('button', { name: 'Enter as retailer', exact: true }).click();
  await page.waitForURL('**/workspace?**');
  const f = JSON.parse(await readFile('.local/e2e-fixtures/boreal.json', 'utf8'));
  const r = await page.request.post(`/api/organisations/${f.organisationId}/projects`, {
    data: {
      name: 'Photo acceptance ' + randomUUID().slice(0, 8),
      customerId: null,
      budgetMinor: 500000,
      currency: 'EUR',
      style: '',
      roomType: 'bedroom',
      room: {
        name: 'Measured photo room',
        width: 6,
        depth: 5,
        height: 2.7,
        measurementsConfirmed: true,
        openings: [],
        zones: [],
      },
    },
  });
  expect(r.status()).toBe(201);
  const project = await r.json();
  await page.goto(`/projects/${project.id}`);
  const {
    referenceId,
    stage,
    calibration: actualCalibration,
  } = await calibratePhotoInBrowser(page, project.id);
  await expect(page.getByRole('button', { name: '3D room view', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Furniture variant', { exact: true })).toHaveCount(0);
  return { projectId: project.id as string, referenceId, stage, actualCalibration };
}
async function clickWorld(
  page: Page,
  p: { x: number; y: number; z: number },
  actualCalibration: PhotoCalibration,
) {
  const pixel = projectPhotoPoint(calibratePhoto(actualCalibration), p),
    stage = page.locator('.photo-stage'),
    b = (await stage.boundingBox())!;
  await stage.click({ position: { x: pixel.x * b.width, y: pixel.y * b.height } });
}
async function worker(page: Page) {
  await runPhotoJob(page);
}
async function saveReviewedSelections(page: Page, photoPath: string) {
  const saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === photoPath && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save reviewed selections', exact: true }).click();
  expect((await saved).status()).toBe(200);
}

test('salesperson calibrates a photo, places an actual SKU, drags and rotates its measured footprint, and reloads the same scene', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { projectId, referenceId, actualCalibration } = await setup(page);
  await expect(page.getByRole('button', { name: 'Place Pine oak bedside', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Place Pine oak bedside', exact: true }).click();
  await clickWorld(page, { x: 3, y: 0, z: 2 }, actualCalibration);
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await expect(page.getByTestId('photo-image-status')).toHaveAttribute('data-ready', 'true');
  let scene = (await get(page, `/api/projects/${projectId}/scene`)).scene as Scene;
  expect(scene.objects).toHaveLength(1);
  const object = scene.objects[0];
  expect(object.sku).toBe('BL-PINE');
  expect(object.dimensions).toEqual({ width: 0.5, depth: 0.4, height: 0.55 });
  expect(object.transform.x).toBeCloseTo(3, 2);
  expect(object.transform.z).toBeCloseTo(2, 2);
  await dragPhotoProduct(
    page,
    object.id,
    { x: object.transform.x, z: object.transform.z },
    { x: 4, z: 2.5 },
    actualCalibration,
  );
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  scene = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  expect(scene.objects[0].transform.x).toBeCloseTo(4, 1);
  expect(scene.objects[0].transform.z).toBeCloseTo(2.5, 1);
  await page.getByRole('button', { name: 'Rotate measured footprint', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  scene = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  expect(scene.objects[0].transform.rotation).toBeCloseTo(Math.PI / 2, 5);
  await expect(page.getByTestId(`photo-object-${object.id}`)).toHaveAttribute(
    'data-x',
    String(scene.objects[0].transform.x),
  );
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveCount(0);
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene).toEqual(scene);
  await page.reload();
  await expect(page.getByTestId('photo-studio')).toHaveAttribute('data-calibrated', 'true');
  expect((await get(page, `/api/projects/${projectId}/photos/${referenceId}`)).calibration.floor).toEqual(
    actualCalibration.floor,
  );
  await page.getByTestId(`photo-object-${object.id}`).click();
  await page.getByRole('button', { name: 'Remove selected furniture', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene.objects).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('quotation preparation requires reviewed accepted furniture and is invalidated by layout and photo changes', async ({
  page,
}) => {
  const { projectId, actualCalibration } = await setup(page);
  const review = page.getByTestId('photo-design-review');
  const quotation = page.getByRole('button', { name: 'Review quotation', exact: true });
  const confirm = page.getByRole('button', { name: 'Confirm design for quotation', exact: true });
  await expect(quotation).toBeDisabled();
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Place Pine oak bedside', exact: true }).click();
  await clickWorld(page, { x: 3, y: 0, z: 2 }, actualCalibration);
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await confirmPhotoDesign(page);
  await expect(review).toHaveAttribute('data-confirmed', 'true');

  await page.getByRole('button', { name: 'Add furniture selection', exact: true }).click();
  await expect(review).toHaveAttribute('data-confirmed', 'false');
  await expect(quotation).toBeDisabled();
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: 'Discard selection 1', exact: true }).click();
  await confirmPhotoDesign(page);

  await page.getByRole('button', { name: 'Show original photo', exact: true }).click();
  await expect(review).toHaveAttribute('data-confirmed', 'false');
  await expect(quotation).toBeDisabled();
  await page.getByRole('button', { name: 'Show proposed furniture', exact: true }).click();
  await confirmPhotoDesign(page);

  await page.getByRole('button', { name: 'Rotate measured footprint', exact: true }).click();
  await expect(review).toHaveAttribute('data-confirmed', 'false');
  await expect(quotation).toBeDisabled();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await confirmPhotoDesign(page);

  await page.getByRole('button', { name: 'Adjust photo calibration', exact: true }).click();
  await page.getByRole('button', { name: 'Save photo calibration', exact: true }).click();
  await expect(review).toHaveAttribute('data-confirmed', 'false');
  await expect(quotation).toBeDisabled();
  await confirmPhotoDesign(page);
  await quotation.click();
  await page.getByRole('button', { name: 'Issue reviewed quotation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Issued quotation details', exact: true })).toBeVisible();
  const quotes = await get(page, `/api/projects/${projectId}/quotations`);
  expect(quotes).toHaveLength(1);
  await page.getByRole('button', { name: 'Rotate measured footprint', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await expect(review).toHaveAttribute('data-confirmed', 'false');
  await expect(quotation).toBeDisabled();
  expect((await page.request.get(`/api/projects/${projectId}/quotations/${quotes[0].id}/pdf`)).status()).toBe(
    200,
  );
  await page.reload();
  await expect(review).toHaveAttribute('data-confirmed', 'false');
  await expect(page.getByRole('button', { name: 'View quotation details', exact: true })).toBeVisible();
});

test('a calibrated photograph with saved catalogue furniture can be edited and quoted without WebGL', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ) {
      if (/^webgl/.test(contextId)) return null;
      return Reflect.apply(getContext, this, [contextId, ...args]);
    } as typeof getContext;
  });
  const { projectId } = await setup(page);
  const initial = (await get(page, `/api/projects/${projectId}/scene`)).scene as Scene;
  const catalogue = await get(page, `/api/organisations/${initial.organisationId}/catalogue`);
  const product = catalogue.find((item: { sku: string }) => item.sku === 'BL-PINE');
  expect(product).toBeTruthy();
  const variant = product.variants[0];
  const preview = await page.request.post(`/api/projects/${projectId}/scene`, {
    data: {
      action: 'preview',
      expectedVersion: initial.version,
      operation: {
        type: 'add-object',
        object: {
          id: randomUUID(),
          variantId: variant.id,
          sku: variant.sku,
          name: product.name,
          category: product.category,
          dimensions: variant.dimensions,
          color: variant.color,
          solid: true,
          locks: { position: false, rotation: false, product: false },
          transform: { x: 3, y: 0, z: 2, rotation: 0 },
        },
      },
    },
  });
  expect(preview.status()).toBe(200);
  const proposal = (await preview.json()).proposal;
  const accepted = await page.request.post(`/api/projects/${projectId}/scene`, {
    data: { action: 'accept', expectedVersion: initial.version, proposalId: proposal.id },
  });
  expect(accepted.status()).toBe(200);
  const saved = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  await page.reload();
  await expect(page.getByTestId('photo-studio')).toHaveAttribute('data-calibrated', 'true');
  await expect(page.getByTestId('photo-image-status')).toHaveAttribute('data-ready', 'true');
  await confirmPhotoDesign(page);
  await expect(page.getByRole('img', { name: 'Client room photograph', exact: true })).toBeVisible();
  await expect(
    page.getByLabel('The client has reviewed these furniture choices and positions.', { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Confirm design for quotation', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review quotation', exact: true })).toBeEnabled();
  await expect(page.getByTestId('photo-design-review')).toHaveAttribute('data-confirmed', 'true');
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene).toEqual(saved);
});

test('completion advice needs reviewed photo choices and a chosen real SKU before it can change the consultation', async ({
  page,
}) => {
  const { projectId, referenceId, actualCalibration } = await setup(page);
  const photoPath = `/api/projects/${projectId}/photos/${referenceId}`;
  const initialScene = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  await page.getByRole('button', { name: 'Scan room photograph', exact: true }).click();
  await expect(page.getByText('Room scan: queued', { exact: true })).toBeVisible();
  await worker(page);
  await page.getByRole('button', { name: 'Use detected selections', exact: true }).click();
  await saveReviewedSelections(page, photoPath);
  const reviewed = await get(page, photoPath);
  await expect(page.getByTestId('photo-studio')).toHaveAttribute(
    'data-photo-revision',
    String(reviewed.revision),
  );
  expect(reviewed.regions[0].disposition).toBe('keep');
  await page
    .getByLabel('Design brief', { exact: true })
    .fill('Remove original furniture and complete the room');

  const request = page.waitForRequest(
    (value) => value.method() === 'POST' && value.url().endsWith(`/api/projects/${projectId}/assistant`),
  );
  await page.getByRole('button', { name: 'Request design assistance', exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.referenceIds).toContain(referenceId);
  expect(body.photoWorkspaces).toContainEqual({ referenceId, expectedRevision: reviewed.revision });
  await expect(page.getByText('Assistance job: queued', { exact: true })).toBeVisible();
  await worker(page);
  const advice = page.getByRole('region', { name: 'Design assistance result', exact: true });
  await expect(advice).toContainText('not generated by OpenAI');
  const suggestion = page.getByLabel('Use suggestion for Synthetic existing chest', { exact: true });
  await expect(suggestion).not.toBeChecked();
  expect((await get(page, photoPath)).regions[0].disposition).toBe('keep');
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene).toEqual(initialScene);
  await suggestion.check();
  await page.getByRole('button', { name: 'Save reviewed photo choices', exact: true }).click();
  await expect.poll(async () => (await get(page, photoPath)).regions[0].disposition).toBe('remove');
  const updatedPhoto = await get(page, photoPath);
  await expect(page.getByTestId('photo-studio')).toHaveAttribute(
    'data-photo-revision',
    String(updatedPhoto.revision),
  );
  const photoJobs = await get(page, `${photoPath}/jobs`);
  expect(photoJobs.jobs.filter((job: { kind: string }) => job.kind === 'photo_cleanup')).toHaveLength(0);
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene).toEqual(initialScene);

  // Advice is refreshed against the new reviewed photo revision before choosing inventory.
  await page.getByRole('button', { name: 'Request design assistance', exact: true }).click();
  await expect(page.getByText('Assistance job: queued', { exact: true })).toBeVisible();
  await worker(page);
  await expect(advice).toContainText('not generated by OpenAI');
  const jobs = await get(page, `/api/projects/${projectId}/jobs`);
  const result = jobs.find((job: { kind: string }) => job.kind === 'ai_design').result;
  const selected =
    result.recommendations.find((item: { category: string }) => item.category === 'bedside') ||
    result.recommendations[0];
  expect(selected).toBeTruthy();
  await page.getByRole('button', { name: `Choose ${selected.name} for photograph`, exact: true }).click();
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene).toEqual(initialScene);
  await clickWorld(page, { x: 3, y: 0, z: 2 }, actualCalibration);
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).toBeVisible();
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene).toEqual(initialScene);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  const accepted = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  expect(accepted.objects).toHaveLength(1);
  expect(accepted.objects[0]).toMatchObject({
    variantId: selected.variantId,
    sku: selected.sku,
    dimensions: selected.dimensions,
  });
});

test('pending photo advice disables quotation confirmation and cannot save after the accepted furniture changes', async ({
  page,
}) => {
  const { projectId, referenceId, actualCalibration } = await setup(page);
  const photoPath = `/api/projects/${projectId}/photos/${referenceId}`;
  await page.getByRole('button', { name: 'Place Pine oak bedside', exact: true }).click();
  await clickWorld(page, { x: 3, y: 0, z: 2 }, actualCalibration);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Scan room photograph', exact: true }).click();
  await expect(page.getByText('Room scan: queued', { exact: true })).toBeVisible();
  await worker(page);
  await page.getByRole('button', { name: 'Use detected selections', exact: true }).click();
  await saveReviewedSelections(page, photoPath);
  const reviewed = await get(page, photoPath);
  await expect(page.getByTestId('photo-studio')).toHaveAttribute(
    'data-photo-revision',
    String(reviewed.revision),
  );
  await page
    .getByLabel('Design brief', { exact: true })
    .fill('Remove original furniture and complete the room');
  await page.getByRole('button', { name: 'Request design assistance', exact: true }).click();
  await expect(page.getByText('Assistance job: queued', { exact: true })).toBeVisible();
  await worker(page);
  await page.getByLabel('Use suggestion for Synthetic existing chest', { exact: true }).check();
  await confirmPhotoDesign(page);
  await expect(page.getByTestId('photo-design-review')).toHaveAttribute('data-confirmed', 'true');

  let releaseGet!: () => void;
  let notifyCaptured!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseGet = resolve;
  });
  const captured = new Promise<void>((resolve) => {
    notifyCaptured = resolve;
  });
  const puts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === photoPath) puts.push(request.url());
  });
  const photoUrl = (url: URL) => url.pathname === photoPath;
  await page.route(photoUrl, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    notifyCaptured();
    await released;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Save reviewed photo choices', exact: true }).click();
    await captured;
    await expect(page.getByTestId('photo-design-review')).toHaveAttribute('data-confirmed', 'false');
    await expect(
      page.getByRole('button', { name: 'Confirm design for quotation', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Review quotation', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Rotate measured footprint', exact: true }).click();
    await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
    releaseGet();
    await expect(
      page.getByRole('region', { name: 'Design assistant', exact: true }).getByRole('alert'),
    ).toHaveText('The room or photograph changed. Request fresh completion advice.');
    expect(puts).toEqual([]);
  } finally {
    releaseGet();
    await page.unroute(photoUrl);
  }
  expect((await get(page, photoPath)).revision).toBe(reviewed.revision);
  expect((await get(page, photoPath)).regions[0].disposition).toBe('keep');
  const savedScene = (await get(page, `/api/projects/${projectId}/scene`)).scene as Scene;
  expect(savedScene.objects[0].transform.rotation).toBeCloseTo(Math.PI / 2, 5);
  await expect(page.getByRole('button', { name: 'Review quotation', exact: true })).toBeDisabled();
});

test('reviewed scan and cleanup preserve the original photo and reject stale or foreign photo changes', async ({
  page,
}) => {
  const { projectId, referenceId } = await setup(page),
    path = `/api/projects/${projectId}/photos/${referenceId}`;
  const original = await page.request.get(`/api/projects/${projectId}/references/${referenceId}`),
    hash = createHash('sha256')
      .update(await original.body())
      .digest('hex');
  await expect(page.getByLabel('Photograph AI provider')).toHaveValue('test');
  await page.getByRole('button', { name: 'Scan room photograph', exact: true }).click();
  await expect(page.getByText('Room scan: queued', { exact: true })).toBeVisible();
  await worker(page);
  await page.getByRole('button', { name: 'Use detected selections', exact: true }).click();
  await page.getByLabel('Selection 1 action').selectOption('remove');
  await page.getByRole('button', { name: 'Save reviewed selections', exact: true }).click();
  await page.getByRole('button', { name: 'Remove reviewed areas from photo', exact: true }).click();
  await expect(page.getByText('Photo cleanup: queued', { exact: true })).toBeVisible();
  await worker(page);
  await expect(page.getByRole('img', { name: 'Reviewed cleaned photograph preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Use cleaned photograph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore original background', exact: true })).toBeVisible();
  const state = await get(page, path);
  expect(state.backgroundReferenceId).toBeTruthy();
  const unchanged = await page.request.get(`/api/projects/${projectId}/references/${referenceId}`);
  expect(
    createHash('sha256')
      .update(await unchanged.body())
      .digest('hex'),
  ).toBe(hash);
  expect(
    (
      await page.request.put(path, {
        data: {
          expectedRevision: state.revision - 1,
          calibration: state.calibration,
          regions: state.regions,
          backgroundReferenceId: null,
        },
      })
    ).status(),
  ).toBe(409);
  await page.getByRole('button', { name: 'Show original photo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Client room photograph', exact: true })).toHaveAttribute(
    'src',
    `/api/projects/${projectId}/references/${referenceId}`,
  );
  await page.getByRole('button', { name: 'Show proposed furniture', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Client room photograph', exact: true })).toHaveAttribute(
    'src',
    `/api/projects/${projectId}/references/${state.backgroundReferenceId}`,
  );
  await page.getByRole('button', { name: 'Restore original background', exact: true }).click();
  await expect.poll(async () => (await get(page, path)).backgroundReferenceId).toBeNull();
  // A different client photograph cannot be processed by the recorded fixture adapter.
  const upload = await page.request.post(`/api/projects/${projectId}/references`, {
    multipart: {
      file: {
        name: 'different.png',
        mimeType: 'image/png',
        buffer: await readFile('fixtures/boreal-living/photo-replacement/clean-room.png'),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const other = await upload.json();
  expect(
    (
      await page.request.post(`/api/projects/${projectId}/photos/${other.id}/jobs`, {
        data: {
          kind: 'photo_analysis',
          provider: 'test',
          referenceId: other.id,
          expectedRevision: 0,
          consent: true,
          idempotencyKey: randomUUID(),
        },
      })
    ).status(),
  ).toBe(422);
  await page.goto('/testing');
  await page.getByRole('button', { name: 'Enter as consumer', exact: true }).click();
  await page.waitForURL('**/marketplace');
  expect((await page.request.get(path)).status()).toBe(404);
});

test('photo controls preserve locks and reject overlapping placements without changing saved geometry', async ({
  page,
}) => {
  const { projectId, actualCalibration, stage } = await setup(page);
  await page.getByRole('button', { name: 'Place Pine oak bedside', exact: true }).click();
  await clickWorld(page, { x: 3, y: 0, z: 2 }, actualCalibration);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  for (const lock of ['position', 'rotation', 'product']) {
    await page.getByRole('button', { name: `Lock ${lock}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Unlock ${lock}`, exact: true })).toBeEnabled();
  }
  const saved = (await get(page, `/api/projects/${projectId}/scene`)).scene as Scene,
    object = saved.objects[0];
  expect(object.locks).toEqual({ position: true, rotation: true, product: true });
  await expect(page.getByRole('button', { name: 'Rotate measured footprint', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove selected furniture', exact: true })).toBeDisabled();
  await expect(page.getByTestId('photo-image-status')).toHaveAttribute('data-ready', 'true');
  await stage.scrollIntoViewIfNeeded();
  const b = (await stage.boundingBox())!,
    p = projectPhotoPoint(calibratePhoto(actualCalibration), {
      x: object.transform.x,
      y: 0.55,
      z: object.transform.z,
    });
  await page.mouse.move(b.x + p.x * b.width, b.y + p.y * b.height);
  await page.mouse.down();
  await page.mouse.move(b.x + p.x * b.width + 35, b.y + p.y * b.height, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Place Pine oak bedside', exact: true }).click();
  await clickWorld(page, { x: object.transform.x, y: 0, z: object.transform.z }, actualCalibration);
  await expect(page.getByTestId('photo-studio').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene).toEqual(saved);
});
