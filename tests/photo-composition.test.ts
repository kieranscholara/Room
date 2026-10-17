import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { calibratePhoto, photoProductRect, type PhotoCalibration } from '@roomsell/geometry';
import { createDemoScene } from '@roomsell/scene-core';
vi.mock('server-only', () => ({}));
import { applyImageMask } from '../apps/web/lib/image-mask';
import { catalogueCutout, composeCataloguePhoto } from '../apps/web/lib/photo-composition-renderer';
import { compositionWriteSchema } from '../apps/web/lib/photo-image-contract';
import { composePhotoCleanup, preparePhotoEdit } from '../apps/web/lib/photo-provider';
import { projectFloorImage } from '../apps/web/lib/photo-floor-image';

const calibration = JSON.parse(
  await readFile('fixtures/boreal-living/photo-demo/calibration.json', 'utf8'),
) as PhotoCalibration;
function fixture() {
  const scene = createDemoScene();
  scene.room = { ...scene.room, width: 6, depth: 5, height: 2.7, measurementsConfirmed: true };
  scene.objects = [
    {
      ...scene.objects[0],
      id: randomUUID(),
      dimensions: { width: 0.6, depth: 0.5, height: 0.6 },
      transform: { x: 3, y: 0, z: 2, rotation: 0 },
    },
  ];
  scene.groups = [];
  const assetId = randomUUID();
  return {
    scene,
    layer: { objectId: scene.objects[0].id, assetId, mask: { automatic: true, strokes: [] } },
    workspace: {
      referenceId: randomUUID(),
      projectId: randomUUID(),
      revision: 1,
      calibration,
      regions: [],
      backgroundReferenceId: null,
    },
  };
}
async function pixels() {
  const data = Buffer.alloc(40 * 40 * 4, 255);
  for (let y = 10; y < 30; y++)
    for (let x = 10; x < 30; x++) {
      const p = (y * 40 + x) * 4;
      data[p] = 180;
      data[p + 1] = 25;
      data[p + 2] = 35;
    }
  return data;
}
describe('catalogue image pixel identity and calibration', () => {
  it('projects a rug image into its measured floor footprint and preserves source colours', () => {
    const f = fixture(),
      object = {
        ...f.scene.objects[0],
        category: 'rug' as const,
        dimensions: { width: 2, depth: 1.6, height: 0.02 },
      },
      camera = calibratePhoto(calibration),
      r = photoProductRect(camera, object),
      box = {
        left: Math.round(r.x * 1536),
        top: Math.round(r.y * 1024),
        width: Math.round(r.width * 1536),
        height: Math.round(r.height * 1024),
      },
      source = new Uint8Array([200, 30, 40, 255]);
    const pixels = projectFloorImage(source, 1, 1, object, camera, box, 1536, 1024);
    expect(pixels.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
    expect(pixels.some((v, i) => i % 4 === 3 && v === 0)).toBe(true);
    for (let p = 0; p < pixels.length; p += 4)
      if (pixels[p + 3]) expect([...pixels.subarray(p, p + 4)]).toEqual([200, 30, 40, 255]);
  });
  it('removes only edge-connected backdrop alpha, preserving catalogue RGB and enclosed light details', async () => {
    const input = await pixels();
    input[(20 * 40 + 20) * 4] = 255;
    input[(20 * 40 + 20) * 4 + 1] = 255;
    input[(20 * 40 + 20) * 4 + 2] = 255;
    const before = Buffer.from(input);
    applyImageMask(input, 40, 40, { automatic: true, strokes: [] });
    expect(input[3]).toBe(0);
    expect(input[(20 * 40 + 20) * 4 + 3]).toBe(255);
    for (let p = 0; p < input.length; p += 4)
      expect(input.subarray(p, p + 3)).toEqual(before.subarray(p, p + 3));
  });
  it('brush correction is reversible and never repaints SKU pixels', async () => {
    const data = await pixels(),
      before = Buffer.from(data);
    applyImageMask(data, 40, 40, {
      automatic: false,
      strokes: [
        { mode: 'erase', radius: 0.1, points: [{ x: 0.5, y: 0.5 }] },
        { mode: 'restore', radius: 0.025, points: [{ x: 0.5, y: 0.5 }] },
      ],
    });
    expect(data[(20 * 40 + 20) * 4 + 3]).toBe(255);
    expect(data[(20 * 40 + 23) * 4 + 3]).toBe(0);
    expect(data.subarray((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 3)).toEqual(
      before.subarray((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 3),
    );
  });
  it('preserves authored transparent silhouettes and supports polygon corrections', async () => {
    const data = await pixels();
    data[3] = 0;
    applyImageMask(data, 40, 40, {
      automatic: true,
      outline: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      strokes: [],
    });
    expect(data[(35 * 40 + 35) * 4 + 3]).toBe(0);
    expect(data[(2 * 40 + 2) * 4 + 3]).toBe(255);
  });
  it('trims a reviewed product cutout and refuses empty masks', async () => {
    const f = fixture(),
      bytes = await sharp(await pixels(), { raw: { width: 40, height: 40, channels: 4 } })
        .png()
        .toBuffer();
    const cutout = await catalogueCutout(bytes, f.layer);
    expect(await sharp(cutout).metadata()).toMatchObject({ width: 20, height: 20 });
    await expect(
      catalogueCutout(bytes, {
        ...f.layer,
        mask: {
          automatic: false,
          strokes: [
            {
              mode: 'erase',
              radius: 0.15,
              points: Array.from({ length: 10 }, (_, i) => ({ x: i / 9, y: 0.5 })),
            },
            {
              mode: 'erase',
              radius: 0.15,
              points: Array.from({ length: 10 }, (_, i) => ({ x: i / 9, y: 0.1 })),
            },
            {
              mode: 'erase',
              radius: 0.15,
              points: Array.from({ length: 10 }, (_, i) => ({ x: i / 9, y: 0.9 })),
            },
            {
              mode: 'erase',
              radius: 0.15,
              points: Array.from({ length: 10 }, (_, i) => ({ x: i / 9, y: 0.3 })),
            },
            {
              mode: 'erase',
              radius: 0.15,
              points: Array.from({ length: 10 }, (_, i) => ({ x: i / 9, y: 0.7 })),
            },
          ],
        },
      }),
    ).rejects.toThrow('empty');
  });
  it('uses the saved metric geometry for image bounds without mutating dimensions', () => {
    const f = fixture(),
      before = structuredClone(f.scene.objects[0]),
      camera = calibratePhoto(calibration);
    const rect = photoProductRect(camera, before),
      near = photoProductRect(camera, { ...before, transform: { ...before.transform, x: 4, z: 3 } });
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(near.height).toBeGreaterThan(rect.height);
    expect(f.scene.objects[0]).toEqual(before);
  });
  it('exports a real composed PNG while preserving background pixels outside product/shadow areas', async () => {
    const f = fixture(),
      source = await sharp({ create: { width: 1536, height: 1024, channels: 4, background: '#19334d' } })
        .png()
        .toBuffer(),
      image = await sharp(await pixels(), { raw: { width: 40, height: 40, channels: 4 } })
        .png()
        .toBuffer();
    const output = await composeCataloguePhoto(
      source,
      f.scene,
      f.workspace,
      [f.layer],
      new Map([[f.layer.assetId, image]]),
    );
    const raw = await sharp(output.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(raw.info).toMatchObject({ width: 1536, height: 1024, channels: 4 });
    expect([...raw.data.subarray(0, 4)]).toEqual([25, 51, 77, 255]);
    expect(output.imageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      raw.data.some((v, i) => i % 4 === 0 && v === 180 && raw.data[i + 1] === 25 && raw.data[i + 2] === 35),
    ).toBe(true);
  });
  it('does not allow caller-provided SKU, price, scale or arbitrary image URL in a saved layer', () => {
    const f = fixture();
    expect(
      compositionWriteSchema.safeParse({
        expectedRevision: 0,
        expectedSceneVersion: 0,
        expectedPhotoRevision: 1,
        layers: [{ ...f.layer, sku: 'invented', url: 'https://outside.test/a.png', scale: 99 }],
      }).success,
    ).toBe(false);
  });
  it('protects excluded brush pixels when applying provider cleanup', async () => {
    const source = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ff0000' } })
        .png()
        .toBuffer(),
      generated = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#0000ff' } })
        .png()
        .toBuffer();
    const region = {
      id: randomUUID(),
      label: 'chair',
      bounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      disposition: 'remove' as const,
      foreground: false,
      maskStrokes: [{ mode: 'erase' as const, radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }],
    };
    const prepared = await preparePhotoEdit(source, [region]);
    expect(prepared.mask.length).toBeGreaterThan(0);
    const edited = await composePhotoCleanup(source, generated, [region]),
      raw = await sharp(edited).raw().toBuffer();
    expect([...raw.subarray((50 * 100 + 50) * 4, (50 * 100 + 50) * 4 + 3)]).toEqual([255, 0, 0]);
    expect([...raw.subarray((25 * 100 + 25) * 4, (25 * 100 + 25) * 4 + 3)]).toEqual([0, 0, 255]);
  });
});
