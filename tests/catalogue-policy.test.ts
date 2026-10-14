import { describe, expect, it } from 'vitest';
import {
  catalogueObjectMatches,
  catalogueProductSelectionFromRow,
  catalogueVariantSelectionFromRow,
  isCatalogueVariantAvailable,
  nullableCatalogueTotalMinor,
  projectModelCompatibility,
  resolveObjectModel,
  modelBoundsFromValidation,
  type CatalogueSceneObject,
  type ProjectCatalogueAsset,
} from '@roomsell/catalogue';

const dimensions = { width: 2, depth: 0.7, height: 1.5 };
const product = {
  id: 'product',
  organisationId: 'tenant',
  name: 'Retail desk',
  category: 'desk' as const,
  currency: 'EUR',
  dimensions,
  active: true,
  availability: 'in_stock' as const,
};
const variant = {
  id: 'variant',
  productId: product.id,
  organisationId: 'tenant',
  sku: 'DESK-OAK',
  color: '#112233',
  dimensions,
  active: true,
  availability: 'in_stock' as const,
  stockQuantity: 1,
};
const object: CatalogueSceneObject = {
  variantId: variant.id,
  sku: variant.sku,
  name: product.name,
  category: product.category,
  color: variant.color,
  solid: true,
  dimensions,
};
const asset = (id = 'model', variantId: string | null = variant.id): ProjectCatalogueAsset => ({
  id,
  productId: product.id,
  variantId,
  kind: 'model',
  mimeType: 'model/gltf-binary',
  sizeBytes: 200,
  dimensions,
  validation: {
    units: 'metres',
    bounds: { min: [-1, 0, 0], max: [1, 1.5, 0.7] },
  },
  url: '/api/projects/project/assets/model',
  modelRenderable: true,
  proxyReason: null,
});

describe('shared catalogue placement and identity policy', () => {
  it('preserves stock, parent availability, inactivity and made-to-order decisions', () => {
    expect(isCatalogueVariantAvailable(product, variant)).toBe(true);
    expect(isCatalogueVariantAvailable(product, { ...variant, stockQuantity: 0 })).toBe(false);
    expect(
      isCatalogueVariantAvailable(product, { ...variant, stockQuantity: 0, availability: 'made_to_order' }),
    ).toBe(true);
    expect(isCatalogueVariantAvailable({ ...product, active: false }, variant)).toBe(false);
    expect(isCatalogueVariantAvailable(product, { ...variant, active: false })).toBe(false);
    expect(isCatalogueVariantAvailable({ ...product, availability: 'out_of_stock' }, variant)).toBe(false);
    expect(isCatalogueVariantAvailable(product, { ...variant, availability: 'out_of_stock' })).toBe(false);
  });
  it('matches all authoritative physical and identity metadata exactly', () => {
    expect(catalogueObjectMatches(object, product, variant)).toBe(true);
    const changes = [
      { variantId: 'foreign' },
      { sku: 'forged' },
      { name: 'forged' },
      { category: 'bed' as const },
      { color: '#ffffff' },
      { solid: false },
      { dimensions: { ...dimensions, width: 2.00000001 } },
    ];
    for (const change of changes)
      expect(catalogueObjectMatches({ ...object, ...change }, product, variant)).toBe(false);
    expect(
      catalogueObjectMatches(
        { ...object, category: 'rug', solid: false },
        { ...product, category: 'rug' },
        variant,
      ),
    ).toBe(true);
  });
  it('maps SQL decimal strings once without dropping tenant and variant references', () => {
    const row = {
      id: 'variant',
      organisation_id: 'tenant',
      product_id: 'product',
      name: 'Desk',
      category: 'desk',
      currency: 'EUR',
      width_m: '2',
      depth_m: '0.7',
      height_m: '1.5',
      active: true,
      availability: 'in_stock',
      stock_quantity: '2',
      sku: 'DESK-OAK',
      color: '#112233',
    };
    expect(catalogueProductSelectionFromRow(row)).toMatchObject({ organisationId: 'tenant', dimensions });
    expect(catalogueVariantSelectionFromRow(row)).toMatchObject({
      productId: 'product',
      organisationId: 'tenant',
      stockQuantity: 2,
      dimensions,
    });
  });
  it('preserves empty, repeated, unknown, currency and overflow total semantics', () => {
    expect(nullableCatalogueTotalMinor([], 'EUR')).toBe(0);
    expect(
      nullableCatalogueTotalMinor(
        [
          { priceMinor: 29, quantity: 2, currency: 'EUR' },
          { priceMinor: 29, quantity: 1, currency: 'EUR' },
        ],
        'EUR',
      ),
    ).toBe(87);
    expect(
      nullableCatalogueTotalMinor([{ priceMinor: null, quantity: 1, currency: 'EUR' }], 'EUR'),
    ).toBeNull();
    expect(() =>
      nullableCatalogueTotalMinor([{ priceMinor: 1, quantity: 1, currency: 'USD' }], 'EUR'),
    ).toThrow('currency');
    expect(() =>
      nullableCatalogueTotalMinor(
        [
          { priceMinor: Number.MAX_SAFE_INTEGER, quantity: 2, currency: 'EUR' },
          { priceMinor: null, quantity: 1, currency: 'EUR' },
        ],
        'EUR',
      ),
    ).toThrow('safe');
    expect(() =>
      nullableCatalogueTotalMinor([{ priceMinor: -1, quantity: 1, currency: 'EUR' }], 'EUR'),
    ).toThrow('nonnegative');
  });
});

describe('matching model resolution and unchanged mesh tolerance', () => {
  it('prefers the exact selected variant, with stable ID-order ties', () => {
    const parent = asset('a-parent', null);
    expect(resolveObjectModel(object, [parent, asset('z-variant'), asset('b-variant')])).toMatchObject({
      kind: 'model',
      asset: { id: 'b-variant' },
      measuredDimensions: dimensions,
    });
    expect(projectModelCompatibility(object, parent, product, variant, false)).toBeNull();
  });
  it('rejects a differently sized parent, foreign variant and stale saved object', () => {
    expect(
      projectModelCompatibility(
        object,
        asset('parent', null),
        { ...product, dimensions: { ...dimensions, width: 2.01 } },
        variant,
        false,
      ),
    ).toContain('parent');
    expect(projectModelCompatibility(object, asset('foreign', 'other'), product, variant, false)).toContain(
      'another',
    );
    expect(projectModelCompatibility(object, asset(), product, variant, true)).toContain('Saved');
    expect(
      projectModelCompatibility(
        { ...object, dimensions: { ...dimensions, depth: 0.71 } },
        asset(),
        product,
        variant,
        false,
      ),
    ).toContain('Saved');
  });
  it('accepts export precision without changing scene dimensions or adding a scale', () => {
    const model = asset();
    model.validation.bounds = { min: [-1.015, 0, 0], max: [1.015, 1.5, 0.7] };
    const before = structuredClone(object);
    expect(projectModelCompatibility(object, model, product, variant, false)).toBeNull();
    expect(resolveObjectModel(object, [model])).toMatchObject({
      kind: 'model',
      measuredDimensions: { width: 2.03 },
    });
    expect(resolveObjectModel(object, [model])).not.toHaveProperty('scale');
    expect(object).toEqual(before);
  });
  it('keeps declared validation dimensions exact while accepting normal float32 measured export precision', () => {
    const furniture = { ...object, dimensions: { ...dimensions, depth: 1.2 } };
    const currentVariant = { ...variant, dimensions: furniture.dimensions };
    const currentProduct = { ...product, dimensions: furniture.dimensions };
    const model = asset();
    model.dimensions = furniture.dimensions;
    model.validation.bounds = { min: [0, 0, 0], max: [2, 1.5, 1.2000000476837158] };
    expect(projectModelCompatibility(furniture, model, currentProduct, currentVariant, false)).toBeNull();
    expect(resolveObjectModel(furniture, [model])).toMatchObject({ kind: 'model' });
    model.dimensions = { ...furniture.dimensions, depth: 1.21 };
    expect(projectModelCompatibility(furniture, model, currentProduct, currentVariant, false)).toContain(
      'Measured',
    );
    expect(resolveObjectModel(furniture, [model])).toMatchObject({ kind: 'proxy' });
  });
  it('uses a labelled proxy for invalid, mismatched or unavailable bounds', () => {
    const bad = asset();
    bad.validation.bounds = { min: [0, 0, 0], max: [2.5, 1.5, 0.7] };
    expect(projectModelCompatibility(object, bad, product, variant, false)).toContain('Measured');
    expect(resolveObjectModel(object, [bad])).toMatchObject({ kind: 'proxy' });
    expect(
      resolveObjectModel(object, [
        { ...asset(), modelRenderable: false, proxyReason: 'Dimensions changed.' },
      ]),
    ).toEqual({ kind: 'proxy', reason: 'Dimensions changed.' });
    for (const invalid of [
      null,
      {},
      { bounds: { min: [0, 0, 0], max: [0, 1, 1] } },
      { bounds: { min: [0, 0, 0], max: [Infinity, 1, 1] } },
    ])
      expect(modelBoundsFromValidation(invalid)).toBeNull();
  });
});
