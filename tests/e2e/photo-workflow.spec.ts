import { expect, test, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { calibratePhoto, projectPhotoPoint, type PhotoCalibration } from '@roomsell/geometry';
import type { Scene } from '@roomsell/scene-core';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});
test.setTimeout(180000);
const calibration = JSON.parse(
  await readFile('fixtures/boreal-living/photo-demo/calibration.json', 'utf8'),
) as PhotoCalibration;
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
  await page.getByRole('button', { name: 'Client photograph', exact: true }).click();
  await page
    .getByLabel('Upload client room photograph', { exact: true })
    .setInputFiles('fixtures/boreal-living/photo-demo/room.png');
  await expect(page.getByRole('img', { name: 'Client room photograph', exact: true })).toBeVisible();
  const refs = await get(page, `/api/projects/${project.id}/references`);
  expect(refs).toHaveLength(1);
  const stage = page.locator('.photo-stage');
  await expect(stage).toBeVisible();
  await page.getByLabel('Floor rectangle x (m)', { exact: true }).fill('1');
  await page.getByLabel('Floor rectangle z (m)', { exact: true }).fill('1');
  await page.getByLabel('Floor rectangle width (m)', { exact: true }).fill('3');
  await page.getByLabel('Floor rectangle depth (m)', { exact: true }).fill('2');
  for (const p of calibration.points) {
    const b = (await stage.boundingBox())!;
    await stage.click({ position: { x: p.x * b.width, y: p.y * b.height } });
  }
  await page.getByRole('button', { name: 'Save photo calibration', exact: true }).click();
  await expect(page.getByTestId('photo-studio')).toHaveAttribute('data-calibrated', 'true');
  const actualCalibration = (await get(page, `/api/projects/${project.id}/photos/${refs[0].id}`))
    .calibration as PhotoCalibration;
  return { projectId: project.id as string, referenceId: refs[0].id as string, stage, actualCalibration };
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
  const token = await readFile('.local/e2e-fixtures/worker-token', 'utf8');
  const r = await page.request.post('/api/internal/jobs/run', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(r.status()).toBe(200);
}

test('salesperson calibrates a photo, places an actual SKU, drags and rotates its real model, and reloads the same scene', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { projectId, referenceId, stage, actualCalibration } = await setup(page);
  await expect(page.getByRole('button', { name: 'Place Pine oak bedside', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Place Pine oak bedside', exact: true }).click();
  await clickWorld(page, { x: 3, y: 0, z: 2 }, actualCalibration);
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await expect(page.getByTestId('photo-model-status')).toHaveAttribute('data-ready', 'true');
  let scene = (await get(page, `/api/projects/${projectId}/scene`)).scene as Scene;
  expect(scene.objects).toHaveLength(1);
  const object = scene.objects[0];
  expect(object.sku).toBe('BL-PINE');
  expect(object.dimensions).toEqual({ width: 0.5, depth: 0.4, height: 0.55 });
  expect(object.transform.x).toBeCloseTo(3, 2);
  expect(object.transform.z).toBeCloseTo(2, 2);
  const pose = calibratePhoto(actualCalibration),
    from = projectPhotoPoint(pose, { x: object.transform.x, y: 0.55, z: object.transform.z }),
    to = projectPhotoPoint(pose, { x: 4, y: 0.55, z: 2.5 });
  await stage.scrollIntoViewIfNeeded();
  const b = (await stage.boundingBox())!;
  await page.mouse.move(b.x + from.x * b.width, b.y + from.y * b.height);
  await page.mouse.down();
  await page.mouse.move(b.x + to.x * b.width, b.y + to.y * b.height, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  scene = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  expect(scene.objects[0].transform.x).toBeCloseTo(4, 1);
  expect(scene.objects[0].transform.z).toBeCloseTo(2.5, 1);
  await page.getByRole('button', { name: 'Rotate selected furniture', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  scene = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  expect(scene.objects[0].transform.rotation).toBeCloseTo(Math.PI / 2, 5);
  await page.getByRole('button', { name: '2D floor plan', exact: true }).click();
  await expect(page.getByLabel('X position (m)', { exact: true })).toHaveValue(
    String(scene.objects[0].transform.x),
  );
  await page.getByRole('button', { name: '3D room view', exact: true }).click();
  await expect(page.getByTestId('room-3d-viewer')).toHaveAttribute('data-ready', 'true');
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene).toEqual(scene);
  await page.reload();
  await page.getByRole('button', { name: 'Client photograph', exact: true }).click();
  await expect(page.getByTestId('photo-studio')).toHaveAttribute('data-calibrated', 'true');
  expect((await get(page, `/api/projects/${projectId}/photos/${referenceId}`)).calibration.floor).toEqual(
    calibration.floor,
  );
  await page.getByTestId(`photo-object-${object.id}`).click();
  await page.getByRole('button', { name: 'Remove selected furniture', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  expect((await get(page, `/api/projects/${projectId}/scene`)).scene.objects).toHaveLength(0);
  expect(errors).toEqual([]);
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
        buffer: await readFile('fixtures/boreal-living/images/room.png'),
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
  await expect(page.getByRole('button', { name: 'Rotate selected furniture', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove selected furniture', exact: true })).toBeDisabled();
  await expect(page.getByTestId('photo-model-status')).toHaveAttribute('data-ready', 'true');
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
