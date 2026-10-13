import { expect, test } from '@playwright/test';
import { rm } from 'node:fs/promises';
test.beforeAll(async () => {
  await rm('.local/e2e', { recursive: true, force: true });
});
test('flagship lock, move, rearrange, preview, persist, undo/redo workflow', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The calm bedroom' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
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
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.getByTestId('select-rug').click();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate 90 degrees', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('canvas drag creates a checked proposal and preserves locked furniture', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  const before = (await (await request.get('/api/scene')).json()).scene;
  const bed = before.objects.find((o: { id: string }) => o.id === 'bed');
  const bounds = (await page.locator('canvas').boundingBox())!;
  const scale = Math.min((bounds.width - 100) / 6, (bounds.height - 110) / 5);
  const originX = bounds.x + (bounds.width - 6 * scale) / 2;
  const originZ = bounds.y + (bounds.height - 5 * scale) / 2;
  await page.mouse.move(originX + bed.transform.x * scale, originZ + bed.transform.z * scale);
  await page.mouse.down();
  await page.mouse.move(originX + 3 * scale, originZ + 3.3 * scale, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  expect((await (await request.get('/api/scene')).json()).scene).toEqual(before);
  await page.getByRole('button', { name: 'Accept layout' }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  const after = (await (await request.get('/api/scene')).json()).scene;
  expect(after.objects.find((o: { id: string }) => o.id === 'bed').transform.z).toBe(3.3);
  expect(after.objects.find((o: { id: string }) => o.id === 'wardrobe')).toEqual(
    before.objects.find((o: { id: string }) => o.id === 'wardrobe'),
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
  test('touch dragging changes only a preview until explicitly accepted', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toHaveCount(1);
    const before = (await (await request.get('/api/scene')).json()).scene;
    const bed = before.objects.find((o: { id: string }) => o.id === 'bed');
    const bounds = (await page.locator('canvas').boundingBox())!;
    const scale = Math.min((bounds.width - 100) / 6, (bounds.height - 110) / 5);
    const x = bounds.x + (bounds.width - 6 * scale) / 2 + bed.transform.x * scale;
    const startZ = bounds.y + (bounds.height - 5 * scale) / 2 + bed.transform.z * scale;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startZ }] });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: startZ + (0.2 * scale * i) / 8 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
    expect((await (await request.get('/api/scene')).json()).scene).toEqual(before);
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  });
});
