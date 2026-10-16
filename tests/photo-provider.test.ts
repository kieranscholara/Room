import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
vi.mock('server-only', () => ({}));
import {
  analysePhoto,
  cleanupPhoto,
  composePhotoCleanup,
  preparePhotoEdit,
} from '../apps/web/lib/photo-provider';
import { photoWriteSchema } from '../apps/web/lib/photo-contract';
const source = () =>
  sharp({ create: { width: 100, height: 80, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
const region = () => ({
  id: randomUUID(),
  label: 'Existing chair',
  bounds: { x: 0.2, y: 0.25, width: 0.3, height: 0.25 },
  disposition: 'remove' as const,
  foreground: false,
});
afterEach(() => vi.unstubAllEnvs());
describe('private photograph analysis and bounded removal', () => {
  it('rejects overflowing areas, invented measurement fields and duplicate IDs', () => {
    const r = region(),
      body = { expectedRevision: 0, calibration: null, regions: [r], backgroundReferenceId: null };
    expect(photoWriteSchema.safeParse(body).success).toBe(true);
    expect(photoWriteSchema.safeParse({ ...body, regions: [r, r] }).success).toBe(false);
    expect(
      photoWriteSchema.safeParse({ ...body, regions: [{ ...r, bounds: { ...r.bounds, x: 0.9 } }] }).success,
    ).toBe(false);
    expect(photoWriteSchema.safeParse({ ...body, measuredWidth: 1 }).success).toBe(false);
  });
  it('does not contact a provider without configured credentials', async () => {
    vi.stubEnv('ROOMSELL_AI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    const transport = vi.fn();
    await expect(analysePhoto(await source(), transport)).rejects.toThrow('Configure');
    expect(transport).not.toHaveBeenCalled();
  });
  it('uses non-stored structured vision and refuses invented dimensions in the response', async () => {
    vi.stubEnv('ROOMSELL_AI_API_KEY', 'unit-test-only');
    let body: Record<string, unknown> = {};
    const transport = vi.fn(async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  summary: 'A chair',
                  objects: [{ label: 'Chair', bounds: region().bounds, dimensions: { width: 1 } }],
                }),
              },
            ],
          },
        ],
      });
    }) as typeof fetch;
    await expect(analysePhoto(await source(), transport)).rejects.toThrow('invalid photograph selections');
    expect(body.store).toBe(false);
  });
  it('rejects an overflowing AI selection instead of silently clipping it', async () => {
    vi.stubEnv('ROOMSELL_AI_API_KEY', 'unit-test-only');
    const transport = vi.fn(async () =>
      Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  summary: 'Chair',
                  objects: [{ label: 'Chair', bounds: { x: 0.95, y: 0.1, width: 0.2, height: 0.2 } }],
                }),
              },
            ],
          },
        ],
      }),
    ) as typeof fetch;
    await expect(analysePhoto(await source(), transport)).rejects.toThrow('invalid photograph selections');
  });
  it('preserves every original pixel outside reviewed regions, including on non-square photos', async () => {
    const original = await source(),
      r = region(),
      generated = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
    const result = await composePhotoCleanup(original, generated, [r]);
    const a = await sharp(original).removeAlpha().raw().toBuffer(),
      b = await sharp(result).removeAlpha().raw().toBuffer();
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 100; x++) {
        const offset = (y * 100 + x) * 3;
        const inside = x >= 20 && x < 50 && y >= 20 && y < 40;
        expect([...b.subarray(offset, offset + 3)]).toEqual(
          inside ? [255, 255, 255] : [...a.subarray(offset, offset + 3)],
        );
      }
    const mask = await preparePhotoEdit(original, [r]);
    const meta = await sharp(mask.mask).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([1024, 1024, true]);
  });
  it('rejects provider image sizes that do not match the requested edit frame', async () => {
    await expect(composePhotoCleanup(await source(), await source(), [region()])).rejects.toThrow(
      'unexpected image size',
    );
  });
  it('submits a masked edit and does not accept a remote output URL', async () => {
    vi.stubEnv('ROOMSELL_AI_API_KEY', 'unit-test-only');
    let form: FormData;
    const transport = vi.fn(async (_url, options) => {
      form = options?.body as FormData;
      return Response.json({ data: [{ url: 'https://example.test/image.png' }] });
    }) as typeof fetch;
    await expect(cleanupPhoto(await source(), [region()], transport)).rejects.toThrow(
      'invalid edited photograph',
    );
    expect(form!.get('mask')).toBeInstanceOf(File);
    expect(form!.get('size')).toBe('1024x1024');
  });
  it('registers bounded selections for the reproducible synthetic demonstration', async () => {
    const analysis = JSON.parse(await readFile('fixtures/boreal-living/photo-demo/analysis.json', 'utf8'));
    expect(analysis.objects).toHaveLength(1);
    const image = await sharp(await readFile('fixtures/boreal-living/photo-demo/room.png')).metadata();
    expect(image.width).toBe(1536);
  });
});
