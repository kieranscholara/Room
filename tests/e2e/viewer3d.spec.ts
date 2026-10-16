import { expect, test, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { BoxGeometry, PerspectiveCamera, Vector3 } from 'three';
import type { CatalogueProduct, ProductInput } from '@roomsell/catalogue';
import type { Scene, SceneObject } from '@roomsell/scene-core';

// These flags select Chromium's software WebGL implementation in headless CI.
// They affect only this renderer acceptance suite.
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});
test.setTimeout(180_000);
const room = {
  name: '3D parity room',
  width: 6,
  depth: 5,
  height: 2.7,
  measurementsConfirmed: true,
  openings: [],
  zones: [],
};
const dimensions = { width: 2, depth: 1.2, height: 1 };

function modelFile() {
  const geometry = new BoxGeometry(dimensions.width, dimensions.height, dimensions.depth);
  geometry.translate(dimensions.width / 2, dimensions.height / 2, dimensions.depth / 2);
  const positions = geometry.getAttribute('position');
  const indices = geometry.index!;
  const bin = Buffer.alloc(positions.count * 12 + indices.count * 2);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.count; index++)
    [positions.getX(index), positions.getY(index), positions.getZ(index)].forEach((value, axis) => {
      bin.writeFloatLE(value, index * 12 + axis * 4);
      minimum[axis] = Math.min(minimum[axis], value);
      maximum[axis] = Math.max(maximum[axis], value);
    });
  for (let index = 0; index < indices.count; index++)
    bin.writeUInt16LE(indices.getX(index), positions.count * 12 + index * 2);
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [4, -1, 8] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.55, 0.3, 0.16, 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteLength: positions.count * 12, target: 34962 },
      { buffer: 0, byteOffset: positions.count * 12, byteLength: indices.count * 2, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        type: 'VEC3',
        count: positions.count,
        min: minimum,
        max: maximum,
      },
      { bufferView: 1, componentType: 5123, type: 'SCALAR', count: indices.count },
    ],
  };
  const raw = Buffer.from(JSON.stringify(document));
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
  raw.copy(json);
  const result = Buffer.alloc(28 + json.length + bin.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20);
  result.writeUInt32LE(bin.length, 20 + json.length);
  result.writeUInt32LE(0x004e4942, 24 + json.length);
  bin.copy(result, 28 + json.length);
  geometry.dispose();
  return result;
}
async function apiScene(page: Page, id: string): Promise<Scene> {
  const result = await page.request.get(`/api/projects/${id}/scene`);
  expect(result.status()).toBe(200);
  return (await result.json()).scene;
}
async function setupProject(page: Page, withModel: boolean) {
  const signup = await page.request.post('/api/auth/signup', {
    data: {
      email: `viewer-${randomUUID()}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName: '3D renderer acceptance',
    },
  });
  expect(signup.status()).toBe(201);
  const orgResult = await page.request.post('/api/organisations', {
    data: { name: `3D Retailer ${randomUUID().slice(0, 8)}`, currency: 'EUR' },
  });
  expect(orgResult.status()).toBe(201);
  const org = await orgResult.json();
  const productInput: ProductInput = {
    sku: `3D-${randomUUID().slice(0, 8)}`,
    name: 'Asymmetric retailer piece',
    category: 'bed',
    dimensions,
    currency: 'EUR',
    priceMinor: 25000,
    color: '#aa7755',
    material: 'Wood',
    active: true,
    availability: 'made_to_order',
    stockQuantity: 0,
    leadTimeDays: 5,
    variants: [],
  };
  const productResult = await page.request.post(`/api/organisations/${org.id}/catalogue`, {
    data: productInput,
  });
  expect(productResult.status()).toBe(201);
  const product = (await productResult.json()) as CatalogueProduct;
  let modelAssetId = '';
  if (withModel) {
    const upload = await page.request.post(`/api/organisations/${org.id}/catalogue/${product.id}/assets`, {
      multipart: {
        variantId: product.variants[0].id,
        file: { name: 'asymmetric-retailer.glb', mimeType: 'model/gltf-binary', buffer: modelFile() },
      },
    });
    expect(upload.status()).toBe(201);
    modelAssetId = (await upload.json()).id;
  }
  const deskResult = await page.request.post(`/api/organisations/${org.id}/catalogue`, {
    data: {
      ...productInput,
      sku: `DESK-${randomUUID().slice(0, 8)}`,
      name: 'Proxy retailer desk',
      category: 'desk',
      dimensions: { width: 0.8, depth: 0.7, height: 0.7 },
    },
  });
  expect(deskResult.status()).toBe(201);
  const desk = (await deskResult.json()) as CatalogueProduct;
  const projectResult = await page.request.post(`/api/organisations/${org.id}/projects`, {
    data: {
      name: 'Synchronized measured project',
      customerId: null,
      budgetMinor: 100000,
      currency: 'EUR',
      style: '',
      roomType: 'bedroom',
      room,
    },
  });
  expect(projectResult.status()).toBe(201);
  const project = await projectResult.json();
  const objects: SceneObject[] = [product, desk].map((entry, index) => ({
    id: randomUUID(),
    variantId: entry.variants[0].id,
    sku: entry.variants[0].sku,
    name: entry.name,
    category: entry.category,
    color: entry.variants[0].color,
    dimensions: entry.variants[0].dimensions,
    solid: true,
    locks: { position: index === 0, rotation: index === 0, product: index === 0 },
    transform: { x: index === 0 ? 2 : 4.6, y: 0, z: index === 0 ? 2 : 4.1, rotation: index === 0 ? 0.37 : 0 },
  }));
  for (const [version, object] of objects.entries()) {
    const preview = await page.request.post(`/api/projects/${project.id}/scene`, {
      data: { action: 'preview', expectedVersion: version, operation: { type: 'add-object', object } },
    });
    expect(preview.status()).toBe(200);
    const proposal = (await preview.json()).proposal;
    expect(
      (
        await page.request.post(`/api/projects/${project.id}/scene`, {
          data: { action: 'accept', expectedVersion: version, proposalId: proposal.id },
        })
      ).status(),
    ).toBe(200);
  }
  return { projectId: project.id as string, objects, modelAssetId };
}

test('real validated GLB, proxy geometry, selection and revisions stay synchronized across 2D and 3D', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { projectId, objects } = await setupProject(page, true);
  const initial = await apiScene(page, projectId);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '3D room view', exact: true }).click();
  const viewer = page.getByTestId('room-3d-viewer');
  await expect(viewer).toHaveAttribute('data-ready', 'true');
  const model = viewer.locator(`[data-object-id="${objects[0].id}"]`);
  const proxy = viewer.locator(`[data-object-id="${objects[1].id}"]`);
  await expect(model).toHaveAttribute('data-render-kind', 'model');
  await expect(proxy).toHaveAttribute('data-render-kind', 'proxy');
  await expect(viewer.getByLabel('3D dimension and model status')).toContainText(
    '1 validated model · 1 dimension proxy',
  );
  await expect(model).toHaveAttribute('data-yaw', '0.37');
  await page.getByRole('button', { name: 'Select Proxy retailer desk in 3D', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'X position (m)', exact: true })).toHaveValue('4.6');
  // Raycast a known world point into the real canvas, exercising mesh selection.
  const canvas = page.getByTestId('room-3d-canvas');
  const box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(45, box.width / box.height, 0.01, 200);
  camera.position.set(7.8, 5.4, 7.9);
  camera.lookAt(new Vector3(3, 0.3, 2.5));
  camera.updateMatrixWorld();
  const point = new Vector3(2, 0.5, 2).project(camera);
  await canvas.click({
    position: { x: ((point.x + 1) * box.width) / 2, y: ((1 - point.y) * box.height) / 2 },
  });
  await expect(model).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('spinbutton', { name: 'X position (m)', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Zoom in 3D', exact: true }).click();
  await page.getByRole('button', { name: 'Fit 3D room', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh 3D models', exact: true }).click();
  await expect(model).toHaveAttribute('data-render-kind', 'model');
  expect(await apiScene(page, projectId)).toEqual(initial);
  await page.getByRole('button', { name: 'Select Proxy retailer desk in 3D', exact: true }).click();
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Z position (m)', exact: true }).fill('3.5');
  await page.getByRole('spinbutton', { name: 'Rotation (degrees)', exact: true }).fill('90');
  await page.getByRole('button', { name: 'Preview placement', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-preview', 'true');
  await expect(proxy).toHaveAttribute('data-z', '3.5');
  await expect(proxy).toHaveAttribute('data-yaw', String(Math.PI / 2));
  expect(await apiScene(page, projectId)).toEqual(initial);
  await page.getByRole('button', { name: '2D floor plan', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Z position (m)', exact: true })).toHaveValue('3.5');
  await page.getByRole('button', { name: '3D room view', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-preview', 'true');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(proxy).toHaveAttribute('data-z', '4.1');
  await expect(page.getByRole('spinbutton', { name: 'Z position (m)', exact: true })).toHaveValue('4.1');
  await page.getByRole('spinbutton', { name: 'Z position (m)', exact: true }).fill('3.5');
  await page.getByRole('spinbutton', { name: 'Rotation (degrees)', exact: true }).fill('90');
  await page.getByRole('button', { name: 'Preview placement', exact: true }).click();
  await page.getByRole('button', { name: 'Accept layout', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-scene-version', '3');
  const accepted = await apiScene(page, projectId);
  expect(accepted.objects.find((object) => object.id === initial.objects[1].id)?.transform).toMatchObject({
    z: 3.5,
    rotation: Math.PI / 2,
  });
  expect(accepted.objects[0]).toEqual(initial.objects[0]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(proxy).toHaveAttribute('data-z', '4.1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(proxy).toHaveAttribute('data-z', '3.5');
  await page.getByText('Compare saved layouts', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Compare with revision' }).selectOption('2');
  await expect(viewer).toContainText('Purple outlines compare saved revision 2.');
  await page.screenshot({ path: 'test-results/room-viewer-3d.png', fullPage: true });
  expect((await apiScene(page, projectId)).objects[0]).toEqual(initial.objects[0]);
  expect(errors).toEqual([]);
});

test('WebGL failure offers the working 2D editor without changing saved furniture', async ({ page }) => {
  const { projectId } = await setupProject(page, false);
  const before = await apiScene(page, projectId);
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
  await page.goto(`/projects/${projectId}`);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.getByRole('button', { name: '3D room view', exact: true }).click();
  await expect(page.getByText('3D is unavailable in this browser.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to 2D floor plan', exact: true }).click();
  await expect(page.getByRole('button', { name: '2D floor plan', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(await apiScene(page, projectId)).toEqual(before);
});
