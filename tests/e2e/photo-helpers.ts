import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  calibratePhoto,
  projectPhotoPoint,
  photoPointToFloor,
  type PhotoCalibration,
} from '@roomsell/geometry';
import sharp from 'sharp';

export const measuredPhotoCalibration = JSON.parse(
  await readFile('fixtures/boreal-living/photo-demo/calibration.json', 'utf8'),
) as PhotoCalibration;
export const measuredPhotoPath = 'fixtures/boreal-living/photo-demo/room.png';

/** Test setup through the public API, for tests whose target is pricing or renderer behaviour. */
export async function uploadCalibratedPhoto(request: APIRequestContext, projectId: string) {
  const upload = await request.post(`/api/projects/${projectId}/references`, {
    multipart: {
      file: { name: 'measured-room.png', mimeType: 'image/png', buffer: await readFile(measuredPhotoPath) },
    },
  });
  expect(upload.status()).toBe(201);
  const reference = await upload.json();
  const saved = await request.put(`/api/projects/${projectId}/photos/${reference.id}`, {
    data: {
      expectedRevision: 0,
      calibration: measuredPhotoCalibration,
      regions: [],
      backgroundReferenceId: null,
    },
  });
  expect(saved.status()).toBe(200);
  return { reference, workspace: await saved.json() };
}

/** The actual salesperson upload and four-corner calibration journey. */
export async function calibratePhotoInBrowser(
  page: Page,
  projectId: string,
  options?: { path: string; calibration: PhotoCalibration },
) {
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveCount(0);
  await page
    .getByLabel('Upload client room photograph', { exact: true })
    .setInputFiles(options?.path ?? measuredPhotoPath);
  const image = page.getByRole('img', { name: 'Client room photograph', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1536);
  const stage = page.locator('.photo-stage');
  await expect(stage).toBeVisible();
  for (const name of ['x', 'z', 'width', 'depth'] as const)
    await page
      .getByLabel(`Floor rectangle ${name} (m)`, { exact: true })
      .fill(String((options?.calibration ?? measuredPhotoCalibration).floor[name]));
  for (const point of (options?.calibration ?? measuredPhotoCalibration).points) {
    const bounds = (await stage.boundingBox())!;
    await stage.click({ position: { x: point.x * bounds.width, y: point.y * bounds.height } });
  }
  await page.getByRole('button', { name: 'Save photo calibration', exact: true }).click();
  await expect(page.getByTestId('photo-studio')).toHaveAttribute('data-calibrated', 'true');
  const referencesResponse = await page.request.get(`/api/projects/${projectId}/references`);
  expect(referencesResponse.status()).toBe(200);
  const references = await referencesResponse.json();
  const reference = references.at(-1);
  const workspaceResponse = await page.request.get(`/api/projects/${projectId}/photos/${reference.id}`);
  expect(workspaceResponse.status()).toBe(200);
  const workspace = await workspaceResponse.json();
  return {
    referenceId: reference.id as string,
    stage,
    calibration: workspace.calibration as PhotoCalibration,
  };
}

export async function clickPhotoFloor(
  page: Page,
  position: { x: number; y: number; z: number },
  calibration: PhotoCalibration = measuredPhotoCalibration,
) {
  const point = projectPhotoPoint(calibratePhoto(calibration), position);
  const stage = page.locator('.photo-stage');
  await stage.scrollIntoViewIfNeeded();
  const bounds = (await stage.boundingBox())!;
  await stage.click({ position: { x: point.x * bounds.width, y: point.y * bounds.height } });
}

export async function acceptPhotoPlacement(page: Page) {
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
}

export async function confirmPhotoDesign(page: Page) {
  await renderAndUsePhoto(page);
  await page
    .getByLabel('The client has reviewed these furniture choices and positions.', { exact: true })
    .check();
  const confirm = page.getByRole('button', { name: 'Confirm design for quotation', exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('button', { name: 'Review quotation', exact: true })).toBeEnabled();
}

export async function renderAndUsePhoto(page: Page) {
  await expect(page.getByTestId('photo-image-status')).toHaveAttribute('data-ready', 'true');
  const save = page.getByRole('button', { name: 'Save image layers', exact: true });
  if (
    await page
      .getByText('Image layers have unsaved changes. Save and render before confirming.', { exact: true })
      .isVisible()
  ) {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/composition'),
    );
    await save.click();
    expect((await saved).status()).toBe(200);
  }
  const confirm = page.getByRole('button', { name: 'Confirm design for quotation', exact: true });
  if (await confirm.isEnabled()) return;
  const use = page.getByRole('button', { name: 'Use final photograph', exact: true });
  if ((await use.count()) && (await use.isDisabled())) return;
  const queued = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/composition'),
  );
  await page.getByRole('button', { name: 'Render final photograph', exact: true }).click();
  const response = await queued;
  expect(response.status()).toBe(202);
  const job = await response.json();
  expect((await runPhotoJob(page, job.id)).status).toBe('completed');
  await expect(
    page.getByRole('img', { name: 'Final edited room photograph preview', exact: true }),
  ).toBeVisible();
  await expect(use).toBeEnabled();
  await use.click();
  await expect(use).toBeDisabled();
}

export async function runPhotoJob(page: Page, id?: string) {
  if (!id) {
    const projectId = new URL(page.url()).pathname.split('/')[2];
    await expect
      .poll(async () => {
        const jobs = await (await page.request.get(`/api/projects/${projectId}/jobs`)).json();
        return jobs.find((j: { status: string }) => j.status === 'queued' || j.status === 'running')?.id;
      })
      .toBeTruthy();
    const jobs = await (await page.request.get(`/api/projects/${projectId}/jobs`)).json();
    id = jobs.find((j: { status: string }) => j.status === 'queued' || j.status === 'running').id;
  }
  const token = await readFile('.local/e2e-fixtures/worker-token', 'utf8');
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await page.request.get(`/api/jobs/${id}`);
    expect(result.status()).toBe(200);
    const job = await result.json();
    if (!['queued', 'running'].includes(job.status)) return job;
    expect(
      (
        await page.request.post('/api/internal/jobs/run', { headers: { Authorization: 'Bearer ' + token } })
      ).status(),
    ).toBe(200);
  }
  throw new Error('The target photograph job did not finish within twelve worker batches.');
}

export async function uploadCataloguePhoto(
  request: APIRequestContext,
  organisationId: string,
  productId: string,
) {
  const image = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="100" height="100"><rect x="10" y="10" width="80" height="80" fill="#a53b28"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const result = await request.post(`/api/organisations/${organisationId}/catalogue/${productId}/assets`, {
    multipart: { file: { name: 'reviewed-product.png', mimeType: 'image/png', buffer: image } },
  });
  expect(result.status()).toBe(201);
  return result.json();
}

export async function dragPhotoProduct(
  page: Page,
  objectId: string,
  from: { x: number; z: number },
  to: { x: number; z: number },
  calibration: PhotoCalibration,
) {
  const canvas = page.getByTestId(`photo-image-${objectId}`).locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const hit = await canvas.evaluate((c: HTMLCanvasElement) => {
    const b = c.getBoundingClientRect(),
      rgba = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let x = Math.floor(c.width / 2),
      y = Math.floor(c.height / 2);
    if (rgba[(y * c.width + x) * 4 + 3] < 100) {
      const p = rgba.findIndex((a, i) => i % 4 === 3 && a >= 100);
      if (p < 0) throw new Error('No visible product pixels');
      x = Math.floor(p / 4) % c.width;
      y = Math.floor(Math.floor(p / 4) / c.width);
    }
    const scale = Math.min(b.width / c.width, b.height / c.height);
    return {
      x: b.left + (b.width - c.width * scale) / 2 + (x + 0.5) * scale,
      y: b.top + (b.height - c.height * scale) / 2 + (y + 0.5) * scale,
    };
  });
  const box = (await page.locator('.photo-stage').boundingBox())!,
    pose = calibratePhoto(calibration),
    floor = photoPointToFloor(pose, { x: (hit.x - box.x) / box.width, y: (hit.y - box.y) / box.height }),
    end = projectPhotoPoint(pose, { x: floor.x + to.x - from.x, y: 0, z: floor.z + to.z - from.z });
  await page.mouse.move(hit.x, hit.y);
  await page.mouse.down();
  await page.mouse.move(box.x + end.x * box.width, box.y + end.y * box.height, { steps: 8 });
  await page.mouse.up();
}
