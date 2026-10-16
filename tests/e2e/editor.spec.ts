import { expect, test, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});
test.beforeEach(async () => {
  await rm(process.env.ROOMSELL_EDITOR_E2E_DATA_DIR || '.local/e2e', { recursive: true, force: true });
});

async function openDemo(page: Page) {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'The calm bedroom' })).toBeVisible();
  const viewer = page.getByTestId('room-3d-viewer');
  await expect(viewer).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveCount(0);
  return viewer;
}

test('flagship lock, move, rearrange, preview, persist, undo/redo workflow', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const viewer = await openDemo(page);
  const initial = (await (await request.get('/api/scene')).json()).scene;
  const wardrobe = initial.objects.find((o: { id: string }) => o.id === 'wardrobe');
  await page.getByTestId('select-wardrobe').click();
  await expect(page.getByRole('button', { name: 'Unlock position', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('spinbutton', { name: 'X position (m)' })).toBeDisabled();
  await page.getByTestId('select-bed').click();
  // Save a separate product lock, demonstrating independent lock semantics.
  await page.getByRole('button', { name: 'Lock product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock product', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('spinbutton', { name: 'Z position (m)' }).fill('3.8');
  await page.getByRole('spinbutton', { name: 'Rotation (degrees)' }).fill('180');
  await page.getByRole('button', { name: 'Preview placement' }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  await expect(viewer.locator('[data-object-id="bed"]')).toHaveAttribute('data-z', '3.8');
  expect(
    (await (await request.get('/api/scene')).json()).scene.objects.find((o: { id: string }) => o.id === 'bed')
      .transform.z,
  ).toBe(1.2);
  await page.getByRole('button', { name: 'Accept layout' }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  const accepted = (await (await request.get('/api/scene')).json()).scene;
  expect(accepted.objects.find((o: { id: string }) => o.id === 'wardrobe')).toEqual(wardrobe);
  expect(accepted.objects.find((o: { id: string }) => o.id === 'bedside-left').transform.z).toBeCloseTo(4.5);
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Z position (m)' })).toHaveValue('3.8');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Z position (m)' })).toHaveValue('1.2');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Z position (m)' })).toHaveValue('3.8');
  // An impossible move is rejected visibly without changing the saved coordinates.
  await page.getByRole('spinbutton', { name: 'X position (m)' }).fill('0');
  await page.getByRole('button', { name: 'Preview placement' }).click();
  await expect(page.getByRole('region', { name: 'Room editor' }).getByRole('alert')).toContainText(
    'crosses a room wall',
  );
  expect((await (await request.get('/api/scene')).json()).scene.objects).toEqual(accepted.objects);
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Reload saved' }).click();
  await expect(page.getByRole('spinbutton', { name: 'X position (m)' })).toHaveValue('3');
  await page.screenshot({ path: 'test-results/room-studio-desktop.png', fullPage: true });
});
test('tablet controls are usable and preview can be discarded', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const viewer = await openDemo(page);
  const rug = viewer.getByRole('button', { name: 'Select Woven rug in 3D', exact: true });
  await rug.click();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate 90 degrees', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  await expect(rug).toHaveAttribute('data-yaw', String(Math.PI / 2));
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  await expect(rug).toHaveAttribute('data-yaw', '0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('3D mesh selection and measured controls create a checked manual proposal', async ({
  page,
  request,
}) => {
  const viewer = await openDemo(page);
  const before = (await (await request.get('/api/scene')).json()).scene;
  const bed = before.objects.find((o: { id: string }) => o.id === 'bed');
  await viewer.getByRole('button', { name: 'Select Oak wardrobe in 3D', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'X position (m)', exact: true })).toBeDisabled();
  // Select a real rendered mesh rather than relying only on the accessible object list.
  const canvas = page.getByTestId('room-3d-canvas');
  await canvas.click({ position: { x: 5, y: 5 } });
  await expect(
    viewer.getByRole('button', { name: 'Select Oak wardrobe in 3D', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  const bounds = (await canvas.boundingBox())!;
  const span = Math.max(before.room.width, before.room.depth);
  const centre = new Vector3(before.room.width / 2, 0.3, before.room.depth / 2);
  const camera = new PerspectiveCamera(45, bounds.width / bounds.height, 0.01, 200);
  camera.position.set(
    centre.x + span * 0.8,
    Math.max(before.room.height * 1.8, span * 0.85),
    centre.z + span * 0.9,
  );
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  const point = new Vector3(bed.transform.x, bed.dimensions.height / 2, bed.transform.z).project(camera);
  await canvas.click({
    position: { x: ((point.x + 1) * bounds.width) / 2, y: ((1 - point.y) * bounds.height) / 2 },
  });
  const bedControl = viewer.getByRole('button', { name: 'Select Oak bed in 3D', exact: true });
  await expect(bedControl).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X position (m)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Z position (m)', exact: true }).fill('3.3');
  await page.getByRole('button', { name: 'Preview placement', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  await expect(viewer).toHaveAttribute('data-preview', 'true');
  await expect(bedControl).toHaveAttribute('data-z', '3.3');
  expect((await (await request.get('/api/scene')).json()).scene).toEqual(before);
  await page.getByRole('button', { name: 'Accept layout' }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  const after = (await (await request.get('/api/scene')).json()).scene;
  expect(after.objects.find((o: { id: string }) => o.id === 'bed').transform.z).toBe(3.3);
  expect(after.objects.find((o: { id: string }) => o.id === 'wardrobe')).toEqual(
    before.objects.find((o: { id: string }) => o.id === 'wardrobe'),
  );
  expect(after.objects.find((o: { id: string }) => o.id === 'bedside-left')).toEqual(
    before.objects.find((o: { id: string }) => o.id === 'bedside-left'),
  );
});

test('HTTP boundary rejects invalid, cross-origin, locked and stale writes', async ({ request }) => {
  const scene = (await (await request.get('/api/scene')).json()).scene;
  const wardrobe = scene.objects.find((o: { id: string }) => o.id === 'wardrobe');
  const operation = {
    type: 'transform',
    objectId: 'wardrobe',
    mode: 'smart',
    transform: { ...wardrobe.transform, x: 4 },
  };
  expect(
    (
      await request.post('/api/scene', {
        data: { action: 'preview', expectedVersion: scene.version, operation },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.post('/api/scene', {
        headers: { Origin: 'https://attacker.example' },
        data: { action: 'undo', expectedVersion: scene.version },
      })
    ).status(),
  ).toBe(403);
  expect((await request.post('/api/scene', { data: { action: 'undo', expectedVersion: 0 } })).status()).toBe(
    409,
  );
  expect(
    (
      await request.post('/api/scene', {
        data: { action: 'preview', expectedVersion: scene.version, operation, organisationId: 'foreign' },
      })
    ).status(),
  ).toBe(400);
  expect((await (await request.get('/api/scene')).json()).scene).toEqual(scene);
});

test.describe('touch interaction', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1180 } });
  test('touch selection and placement controls change only a preview until accepted', async ({
    page,
    request,
  }) => {
    const viewer = await openDemo(page);
    const before = (await (await request.get('/api/scene')).json()).scene;
    const bed = viewer.getByRole('button', { name: 'Select Oak bed in 3D', exact: true });
    await bed.tap();
    await expect(bed).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Manual', exact: true }).tap();
    await page.getByRole('spinbutton', { name: 'Z position (m)', exact: true }).fill('2.2');
    await page.getByRole('button', { name: 'Preview placement', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
    await expect(bed).toHaveAttribute('data-z', '2.2');
    expect((await (await request.get('/api/scene')).json()).scene).toEqual(before);
    await page.getByRole('button', { name: 'Discard', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
    await expect(bed).toHaveAttribute('data-z', '1.2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test('without WebGL the accessible furniture list and checked placement controls remain usable', async ({
  page,
  request,
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
  await page.goto('/demo');
  await expect(page.getByText('3D is unavailable in this browser.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Return to 2D floor plan', exact: true })).toHaveCount(0);
  const before = (await (await request.get('/api/scene')).json()).scene;
  const viewer = page.getByTestId('room-3d-viewer');
  await viewer.getByRole('button', { name: 'Select Oak wardrobe in 3D', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'X position (m)', exact: true })).toBeDisabled();
  await viewer.getByRole('button', { name: 'Select Oak bed in 3D', exact: true }).click();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Z position (m)', exact: true }).fill('2.2');
  await page.getByRole('button', { name: 'Preview placement', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-preview', 'true');
  expect((await (await request.get('/api/scene')).json()).scene).toEqual(before);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-preview', 'false');
  const after = (await (await request.get('/api/scene')).json()).scene;
  expect(after.objects.find((object: { id: string }) => object.id === 'bed').transform.z).toBe(2.2);
  expect(after.objects.find((object: { id: string }) => object.id === 'wardrobe')).toEqual(
    before.objects.find((object: { id: string }) => object.id === 'wardrobe'),
  );
});
