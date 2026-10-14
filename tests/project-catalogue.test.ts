import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoScene, type Scene } from '@roomsell/scene-core';
import type { ProjectContext } from '../apps/web/lib/project-service';

const state = vi.hoisted(() => ({
  scene: null as unknown as Scene,
  variants: [] as Array<Record<string, unknown>>,
  assets: [] as Array<Record<string, unknown>>,
  scopes: [] as Array<[string, string, unknown]>,
}));

vi.mock('server-only', () => ({}));
function query(table: string, data: unknown) {
  const self = {
    select: () => self,
    eq: (column: string, value: unknown) => {
      state.scopes.push([table, column, value]);
      return self;
    },
    in: () => self,
    single: async () => ({ data, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  };
  return self;
}
vi.mock('../apps/web/lib/supabase-server', () => ({
  databaseError: (error: unknown) => {
    if (error) throw error;
  },
  adminClient: () => ({
    from: (table: string) => query(table, table === 'product_variants' ? state.variants : state.assets),
  }),
}));

import { selectedProjectProducts } from '../apps/web/lib/project-catalogue';

beforeEach(() => {
  state.scene = createDemoScene();
  state.scene.objects = [state.scene.objects[1]];
  state.scene.groups = [];
  state.scopes = [];
  const object = state.scene.objects[0];
  const dimensions = {
    width_m: object.dimensions.width,
    depth_m: object.dimensions.depth,
    height_m: object.dimensions.height,
  };
  state.variants = [
    {
      id: object.variantId,
      organisation_id: state.scene.organisationId,
      product_id: 'product',
      sku: object.sku,
      name: 'Oak',
      price_minor: 29,
      color: object.color,
      active: true,
      availability: 'in_stock',
      stock_quantity: 1,
      ...dimensions,
      product: {
        id: 'product',
        organisation_id: state.scene.organisationId,
        name: object.name,
        category: object.category,
        currency: 'EUR',
        active: true,
        availability: 'in_stock',
        ...dimensions,
      },
    },
  ];
  state.assets = [];
});
const context = (): ProjectContext =>
  ({
    project: {
      id: 'project',
      organisation_id: state.scene.organisationId,
      currency: 'EUR',
      budget_minor: 28,
    },
    client: { from: (table: string) => query(table, { data: state.scene }) },
  }) as unknown as ProjectContext;

describe('selected project catalogue contract characterisation', () => {
  it('returns exact live totals and additive full private asset metadata scoped to the project tenant', async () => {
    const object = state.scene.objects[0];
    const { width, depth, height } = object.dimensions;
    state.assets = [
      {
        id: 'model',
        product_id: 'product',
        variant_id: object.variantId,
        kind: 'model',
        mime_type: 'model/gltf-binary',
        size_bytes: '400',
        width_m: width,
        depth_m: depth,
        height_m: height,
        validation: { units: 'metres', bounds: { min: [0, 0, 0], max: [width, height, depth] } },
      },
    ];
    const result = await selectedProjectProducts(context());
    expect(result).toMatchObject({
      totalMinor: 29,
      budgetMinor: 28,
      currency: 'EUR',
      overBudget: true,
      stale: false,
    });
    expect(result.items[0]).toMatchObject({ available: true, stale: false, priceMinor: 29 });
    expect(result.items[0].assets[0]).toEqual({
      id: 'model',
      productId: 'product',
      variantId: object.variantId,
      kind: 'model',
      mimeType: 'model/gltf-binary',
      sizeBytes: 400,
      dimensions: object.dimensions,
      validation: state.assets[0].validation,
      url: '/api/projects/project/assets/model',
      modelRenderable: true,
      proxyReason: null,
    });
    expect(state.scopes).toContainEqual(['product_variants', 'organisation_id', state.scene.organisationId]);
    expect(state.scopes).toContainEqual(['product_assets', 'organisation_id', state.scene.organisationId]);
    expect(state.scopes).toContainEqual(['product_assets', 'status', 'validated']);
  });
  it('preserves currency mismatch, missing reference, unavailable and stale metadata semantics', async () => {
    (state.variants[0].product as Record<string, unknown>).currency = 'USD';
    expect(await selectedProjectProducts(context())).toMatchObject({
      totalMinor: null,
      overBudget: null,
      stale: true,
      items: [{ priceMinor: null, available: true }],
    });
    state.variants = [];
    expect(await selectedProjectProducts(context())).toMatchObject({
      totalMinor: null,
      overBudget: null,
      stale: true,
      items: [{ priceMinor: null, available: false }],
    });
  });
  it('counts repeated variants per object and rejects overflow even alongside unknown prices', async () => {
    state.scene.objects.push({ ...state.scene.objects[0], id: 'second-object' });
    expect((await selectedProjectProducts(context())).totalMinor).toBe(58);
    state.variants[0].price_minor = Number.MAX_SAFE_INTEGER;
    state.scene.objects.push({ ...state.scene.objects[0], id: 'missing', variantId: 'missing' });
    await expect(selectedProjectProducts(context())).rejects.toMatchObject({ status: 422 });
  });
  it('retains saved geometry and disables models when current catalogue dimensions drift', async () => {
    state.variants[0].width_m = state.scene.objects[0].dimensions.width + 0.1;
    const before = JSON.stringify(state.scene);
    expect(await selectedProjectProducts(context())).toMatchObject({
      stale: true,
      totalMinor: 29,
      items: [{ available: true, stale: true }],
    });
    expect(JSON.stringify(state.scene)).toBe(before);
  });
});
