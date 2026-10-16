import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { calibratePhoto, projectPhotoPoint, type PhotoCalibration } from '@roomsell/geometry';

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
export async function calibratePhotoInBrowser(page: Page, projectId: string) {
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveCount(0);
  await page.getByLabel('Upload client room photograph', { exact: true }).setInputFiles(measuredPhotoPath);
  const image = page.getByRole('img', { name: 'Client room photograph', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1536);
  const stage = page.locator('.photo-stage');
  await expect(stage).toBeVisible();
  for (const name of ['x', 'z', 'width', 'depth'] as const)
    await page
      .getByLabel(`Floor rectangle ${name} (m)`, { exact: true })
      .fill(String(measuredPhotoCalibration.floor[name]));
  for (const point of measuredPhotoCalibration.points) {
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
  await page
    .getByLabel('The client has reviewed these furniture choices and positions.', { exact: true })
    .check();
  const confirm = page.getByRole('button', { name: 'Confirm design for quotation', exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('button', { name: 'Review quotation', exact: true })).toBeEnabled();
}
