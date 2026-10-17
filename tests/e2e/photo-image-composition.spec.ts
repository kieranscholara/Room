import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { calibratePhoto, projectPhotoPoint, type PhotoCalibration } from '@roomsell/geometry';
import {
  calibratePhotoInBrowser,
  dragPhotoProduct,
  confirmPhotoDesign,
  renderAndUsePhoto,
  runPhotoJob,
} from './photo-helpers';
test.setTimeout(180000);
const calibration = JSON.parse(
  await readFile('fixtures/boreal-living/photo-replacement/calibration.json', 'utf8'),
) as PhotoCalibration;
async function get(page: Page, path: string) {
  const r = await page.request.get(path);
  expect(r.status(), path).toBe(200);
  return r.json();
}
async function worker(page: Page) {
  await runPhotoJob(page);
}
async function setup(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.assign(window, { roomWebGLCalls: 0 });
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      id: string,
      ...args: unknown[]
    ) {
      if (/^webgl/.test(id)) {
        (window as typeof window & { roomWebGLCalls: number }).roomWebGLCalls++;
        return null;
      }
      return Reflect.apply(original, this, [id, ...args]);
    } as typeof original;
  });
  await page.goto('/testing');
  await page.getByRole('button', { name: 'Enter as retailer', exact: true }).click();
  await page.waitForURL('**/workspace?**');
  const fixture = await get(page, '/api/testing/status'),
    result = await page.request.post(`/api/organisations/${fixture.organisationId}/projects`, {
      data: {
        name: 'Photograph replacement ' + randomUUID().slice(0, 6),
        customerId: null,
        budgetMinor: 300000,
        currency: 'EUR',
        style: 'Fictional photographic fixture with assumed measurements',
        roomType: 'bedroom',
        room: {
          name: 'Photo replacement trial',
          width: 4,
          depth: 4.5,
          height: 2.7,
          measurementsConfirmed: true,
          openings: [],
          zones: [],
        },
      },
    });
  expect(result.status()).toBe(201);
  const project = await result.json();
  await page.goto(`/projects/${project.id}`);
  const photo = await calibratePhotoInBrowser(page, project.id, {
    path: 'fixtures/boreal-living/photo-replacement/source.png',
    calibration,
  });
  return { fixture, projectId: project.id as string, photo };
}
async function placeBed(page: Page, cal: PhotoCalibration) {
  await page.getByRole('button', { name: 'Place Linen upholstered bed', exact: true }).click();
  const point = projectPhotoPoint(calibratePhoto(cal), { x: 2, y: 0, z: 2 }),
    stage = page.locator('.photo-stage');
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox())!;
  await stage.click({ position: { x: point.x * box.width, y: point.y * box.height } });
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await expect(page.getByTestId('photo-image-status')).toHaveAttribute('data-ready', 'true');
}
test('salesperson replaces original furniture in an actual photographic fixture, moves a real SKU image and issues its saved photograph with a quote without WebGL', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { fixture, projectId, photo } = await setup(page),
    photoPath = `/api/projects/${projectId}/photos/${photo.referenceId}`,
    source = await page.request.get(`/api/projects/${projectId}/references/${photo.referenceId}`),
    sourceBytes = await source.body(),
    sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  await page.getByRole('button', { name: 'Scan room photograph', exact: true }).click();
  await expect(page.getByText('Room scan: queued', { exact: true })).toBeVisible();
  await worker(page);
  await page.getByRole('button', { name: 'Use detected selections', exact: true }).click();
  await page.getByRole('button', { name: 'Save reviewed selections', exact: true }).click();
  await expect.poll(async () => (await get(page, photoPath)).regions.length).toBe(4);
  await page.getByRole('button', { name: 'Select existing Original upholstered bed', exact: true }).click();
  await page.getByRole('button', { name: 'Replace this object from store', exact: true }).first().click();
  await expect.poll(async () => (await get(page, photoPath)).regions[0].disposition).toBe('remove');
  await expect(page.getByText('Photo cleanup: queued', { exact: true })).toBeVisible();
  await worker(page);
  await expect(
    page.getByRole('img', { name: 'Reviewed cleaned photograph preview', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use cleaned photograph', exact: true }).click();
  await expect.poll(async () => (await get(page, photoPath)).backgroundReferenceId).toBeTruthy();
  await placeBed(page, photo.calibration);
  let scene = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  expect(scene.objects).toHaveLength(1);
  const object = scene.objects[0];
  expect(object).toMatchObject({ sku: 'BL-LINEN', dimensions: { width: 1.8, depth: 2.1, height: 1.15 } });
  await expect(page.getByTestId(`photo-image-${object.id}`)).toHaveAttribute(
    'data-asset-id',
    fixture.replacementAssetId ?? (await get(page, '/api/testing/status')).replacementAssetId,
  );
  await expect(page.getByLabel('Product photograph view', { exact: true })).toHaveValue(
    (await page.getByTestId(`photo-image-${object.id}`).getAttribute('data-asset-id'))!,
  );
  await dragPhotoProduct(page, object.id, { x: 2, z: 2 }, { x: 2.2, z: 2.1 }, photo.calibration);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  scene = (await get(page, `/api/projects/${projectId}/scene`)).scene;
  expect(scene.objects[0].transform.x).toBeCloseTo(2.2, 1);
  expect(scene.objects[0].transform.z).toBeCloseTo(2.1, 1);
  await renderAndUsePhoto(page);
  const state = await get(page, photoPath + '/composition'),
    composition = state.composition;
  expect(composition.layers[0].assetId).toBe(
    await page.getByLabel('Product photograph view', { exact: true }).inputValue(),
  );
  const final = await page.request.get(
      `/api/projects/${projectId}/references/${composition.renderedReferenceId}`,
    ),
    bytes = await final.body();
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(composition.imageSha256);
  const originalPixels = await sharp(sourceBytes).ensureAlpha().raw().toBuffer(),
    finalPixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
  expect(finalPixels.subarray(0, 40)).toEqual(originalPixels.subarray(0, 40));
  expect(bytes.equals(sourceBytes)).toBe(false);
  await confirmPhotoDesign(page);
  await page.getByRole('button', { name: 'Review quotation', exact: true }).click();
  await page.getByRole('button', { name: 'Issue reviewed quotation', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Issued quotation details', exact: true })).toBeVisible();
  const quotes = await get(page, `/api/projects/${projectId}/quotations`);
  expect(quotes[0].snapshot.photo.renderedReferenceId).toBe(composition.renderedReferenceId);
  expect(quotes[0].snapshot.photo.imageSha256).toBe(composition.imageSha256);
  expect(quotes[0].snapshot.source.items[0].sku).toBe('BL-LINEN');
  const pdf = await page.request.get(`/api/projects/${projectId}/quotations/${quotes[0].id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect((await PDFDocument.load(await pdf.body())).getPageCount()).toBeGreaterThanOrEqual(2);
  await page.locator('.photo-stage').screenshot({ path: 'test-results/photograph-replacement.png' });
  await page.reload();
  await expect(page.getByTestId('photo-image-status')).toHaveAttribute('data-ready', 'true');
  expect((await get(page, photoPath + '/composition')).composition.imageSha256).toBe(composition.imageSha256);
  expect(
    createHash('sha256')
      .update(
        await (await page.request.get(`/api/projects/${projectId}/references/${photo.referenceId}`)).body(),
      )
      .digest('hex'),
  ).toBe(sourceHash);
  expect(
    await page.evaluate(() => (window as typeof window & { roomWebGLCalls: number }).roomWebGLCalls),
  ).toBe(0);
  expect(errors).toEqual([]);
});
test('image rendering refuses a changed furniture source and forged product images before confirmation', async ({
  page,
}) => {
  const { projectId, photo } = await setup(page);
  await placeBed(page, photo.calibration);
  const path = `/api/projects/${projectId}/photos/${photo.referenceId}/composition`;
  await page.getByRole('button', { name: 'Save image layers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Render final photograph', exact: true })).toBeEnabled();
  const state = await get(page, path),
    comp = state.composition;
  const forged = await page.request.put(path, {
    data: {
      action: 'save',
      expectedRevision: comp.revision,
      expectedSceneVersion: comp.sceneVersion,
      expectedPhotoRevision: comp.photoRevision,
      layers: [{ ...comp.layers[0], assetId: randomUUID() }],
    },
  });
  expect(forged.ok()).toBe(false);
  await page.getByRole('button', { name: 'Render final photograph', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate measured footprint', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept layout', exact: true })).not.toBeVisible();
  await worker(page);
  await expect(page.getByText(/last image render failed/)).toBeVisible();
  const after = await get(page, path);
  expect(after.jobs[0].errorCode).toBe('source_changed');
  expect(after.composition.renderedReferenceId).toBeNull();
  await expect(page.getByRole('button', { name: 'Review quotation', exact: true })).toBeDisabled();
});
