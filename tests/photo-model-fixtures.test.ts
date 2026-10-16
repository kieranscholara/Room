import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { validateProductAsset } from '@roomsell/catalogue/assets';
import type { ProjectCatalogueAsset } from '@roomsell/catalogue';
import { disposeRoomModel, loadRoomModel } from '../apps/web/lib/3d-model-runtime';
type FixtureProduct = { sku: string; dimensions: { width: number; depth: number; height: number } };
const catalogue = JSON.parse(await readFile('fixtures/boreal-living/catalogue.json', 'utf8')) as {
  products: FixtureProduct[];
};
afterEach(() => vi.unstubAllGlobals());
describe('fictional showroom dimensioned models', () => {
  it.each(catalogue.products)(
    'validates and renders $sku at original metric dimensions',
    async (product: { sku: string; dimensions: { width: number; depth: number; height: number } }) => {
      const bytes = await readFile(`fixtures/boreal-living/models/${product.sku}.glb`),
        validated = await validateProductAsset(bytes, {
          fileName: product.sku + '.glb',
          expectedDimensions: product.dimensions,
        });
      const asset = {
        id: '22222222-2222-4222-8222-222222222222',
        productId: '33333333-3333-4333-8333-333333333333',
        variantId: null,
        kind: 'model',
        mimeType: validated.mimeType,
        sizeBytes: bytes.length,
        dimensions: validated.dimensions,
        validation: validated.validation,
        url: '/api/projects/11111111-1111-4111-8111-111111111111/assets/22222222-2222-4222-8222-222222222222',
        modelRenderable: true,
        proxyReason: null,
      } as ProjectCatalogueAsset;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(bytes)),
      );
      const model = await loadRoomModel(
        '11111111-1111-4111-8111-111111111111',
        asset,
        product.dimensions,
        new AbortController().signal,
      );
      for (const key of ['width', 'height', 'depth'] as const)
        expect(model.dimensions[key]).toBeCloseTo(product.dimensions[key], 6);
      expect(model.bounds.min[1]).toBeCloseTo(0, 7);
      expect(model.scene.scale.toArray()).toEqual([1, 1, 1]);
      disposeRoomModel(model.scene);
    },
  );
});
