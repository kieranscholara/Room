import { expect, test, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import type { Scene } from '@roomsell/scene-core';

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
  const viewer = page.getByTestId('room-3d-viewer');
  await expect(viewer).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveCount(0);
  return viewer;
}

test('confirmed room measurements preview safely and compare with the saved layout', async ({
  page,
  request,
}) => {
  const viewer = await openDemo(page);
  await page.getByText('Room measurements', { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Room width (m)', exact: true }).fill('6.2');
  await expect(page.getByRole('button', { name: 'Preview room dimensions', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I have checked these measurements', exact: true }).check();
  await page.getByRole('button', { name: 'Preview room dimensions', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  await expect(viewer.getByLabel('3D dimension and model status')).toContainText('6.2 × 5 × 2.7 m');
  expect((await (await request.get('/api/scene')).json()).scene.room.width).toBe(6);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  expect((await (await request.get('/api/scene')).json()).scene.room.width).toBe(6.2);
  await page.getByText('Compare saved layouts', { exact: true }).click();
  await expect(page.getByLabel('Compare with revision')).toBeEnabled();
  await page.getByLabel('Compare with revision').selectOption('0');
  await expect(page.locator('.revision-comparison')).toContainText(
    'room measurements or architecture changed',
  );
  await expect(viewer).toContainText('Purple outlines compare saved revision 0.');
  await page.getByRole('button', { name: 'Clear comparison', exact: true }).click();
  await expect(page.locator('.revision-comparison')).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Room width (m)', exact: true }).fill('5');
  await page.getByRole('checkbox', { name: 'I have checked these measurements', exact: true }).check();
  await page.getByRole('button', { name: 'Preview room dimensions', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Room editor' }).getByRole('alert')).toContainText(
    'crosses a room wall',
  );
  expect((await (await request.get('/api/scene')).json()).scene.room.width).toBe(6.2);
});

test('doors, windows and circulation zones can be added, edited and removed', async ({ page, request }) => {
  await openDemo(page);
  await page.locator('.room-controls summary').filter({ hasText: 'Doors & windows' }).click();
  await page.getByRole('textbox', { name: 'Opening name', exact: true }).fill('West side window');
  await page.getByLabel('Opening type', { exact: true }).selectOption('window');
  await page.getByLabel('Opening wall', { exact: true }).selectOption('north');
  await page.getByRole('button', { name: 'Preview opening', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await page.getByRole('button', { name: 'Edit West side window', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Opening width (m)', exact: true }).fill('0.8');
  await page.getByRole('button', { name: 'Preview opening update', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  expect((await (await request.get('/api/scene')).json()).scene.room.openings[0].width).toBe(0.8);
  await page.getByRole('textbox', { name: 'Opening name', exact: true }).fill('South entry');
  await page.getByLabel('Opening type', { exact: true }).selectOption('door');
  await page.getByLabel('Opening wall', { exact: true }).selectOption('south');
  await page.getByRole('button', { name: 'Preview opening', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  expect((await (await request.get('/api/scene')).json()).scene.room.openings).toHaveLength(2);
  await page.locator('.room-controls summary').filter({ hasText: 'Obstacles & circulation' }).click();
  await page.getByRole('textbox', { name: 'Zone name', exact: true }).fill('Clear walkway');
  await page.getByRole('spinbutton', { name: 'Zone Z (m)', exact: true }).fill('1.2');
  await page.getByRole('button', { name: 'Preview zone', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Clear walkway', exact: true }).click();
  await page.getByRole('textbox', { name: 'Zone name', exact: true }).fill('Reserved walkway');
  await page.getByRole('button', { name: 'Preview zone update', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Reserved walkway', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Reserved walkway', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove West side window', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit West side window', exact: true })).toHaveCount(0);
});

test('rigid groups move together in manual mode, lock every member, and can be removed', async ({
  page,
  request,
}) => {
  const viewer = await openDemo(page);
  await page.locator('.group-controls summary').click();
  await page.getByRole('textbox', { name: 'Group name', exact: true }).fill('Bed set');
  await page.getByRole('checkbox', { name: 'Oak bed', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Left bedside', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Right bedside', exact: true }).check();
  await page.getByRole('button', { name: 'Create rigid group', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock group Bed set', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lock group Bed set', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock group Bed set', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Select Oak bed in 3D', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'X position (m)', exact: true })).toBeDisabled();
  await expect(page.getByRole('spinbutton', { name: 'Rotation (degrees)', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Unlock group Bed set', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'X position (m)', exact: true })).toBeEnabled();
  const before: Scene = (await (await request.get('/api/scene')).json()).scene;
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Z position (m)', exact: true }).fill('2.2');
  await page.getByRole('button', { name: 'Preview placement', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  const after: Scene = (await (await request.get('/api/scene')).json()).scene;
  for (const id of ['bed', 'bedside-left', 'bedside-right']) {
    expect(
      after.objects.find((object) => object.id === id)!.transform.z -
        before.objects.find((object) => object.id === id)!.transform.z,
    ).toBeCloseTo(1);
  }
  expect(after.objects.find((object) => object.id === 'wardrobe')).toEqual(
    before.objects.find((object) => object.id === 'wardrobe'),
  );
  await page.getByRole('button', { name: 'Remove group Bed set', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock group Bed set', exact: true })).toHaveCount(0);
  expect((await (await request.get('/api/scene')).json()).scene.groups).toHaveLength(0);
});

test('mobile measured placement controls and distance guides remain accessible', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const viewer = await openDemo(page);
  const before: Scene = (await (await request.get('/api/scene')).json()).scene;
  await page.getByText('Room measurements', { exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Ceiling height (m)', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Select Oak bed in 3D', exact: true }).click();
  await expect(page.getByLabel('Wall distance guides')).toContainText('north');
  await expect(page.getByRole('spinbutton', { name: 'X position (m)', exact: true })).toHaveAttribute(
    'step',
    '0.1',
  );
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Z position (m)', exact: true }).fill('2.2');
  await page.getByRole('button', { name: 'Preview placement', exact: true }).click();
  await expect(viewer.locator('[data-object-id="bed"]')).toHaveAttribute('data-z', '2.2');
  expect((await (await request.get('/api/scene')).json()).scene).toEqual(before);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(viewer.locator('[data-object-id="bed"]')).toHaveAttribute('data-z', '1.2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('nearby wall snapping uses a checked preview before saving', async ({ page, request }) => {
  const viewer = await openDemo(page);
  const bed = viewer.getByRole('button', { name: 'Select Oak bed in 3D', exact: true });
  await bed.click();
  await page.getByRole('button', { name: 'Snap to nearby walls', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Z position (m)', exact: true })).toHaveValue('1');
  await expect(bed).toHaveAttribute('data-z', '1');
  expect(
    (await (await request.get('/api/scene')).json()).scene.objects.find(
      (object: { id: string }) => object.id === 'bed',
    ).transform.z,
  ).toBe(1.2);
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout preview' })).not.toBeVisible();
  expect(
    (await (await request.get('/api/scene')).json()).scene.objects.find(
      (object: { id: string }) => object.id === 'bed',
    ).transform.z,
  ).toBe(1);
  await expect(page.getByLabel('Wall distance guides')).toContainText('0.00 m');
});
