import type { CatalogueAsset, Dimensions } from './index';
import type { CatalogueProductSelection, CatalogueVariantSelection, ProjectCatalogueAsset } from './policy';
import { sameCatalogueDimensions } from './policy';
import { dimensionsWithinModelTolerance } from './asset-policy';

export interface ValidatedModelBounds {
  min: [number, number, number];
  max: [number, number, number];
}
export function modelBoundsFromValidation(validation: unknown): ValidatedModelBounds | null {
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) return null;
  const raw = (validation as Record<string, unknown>).bounds;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bounds = raw as Record<string, unknown>;
  const valid = (value: unknown): value is [number, number, number] =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
  if (
    !valid(bounds.min) ||
    !valid(bounds.max) ||
    bounds.min.some((coordinate, axis) => coordinate >= (bounds.max as number[])[axis])
  )
    return null;
  return { min: [...bounds.min], max: [...bounds.max] };
}
export function modelDimensionsFromBounds(bounds: ValidatedModelBounds): Dimensions {
  return {
    width: bounds.max[0] - bounds.min[0],
    height: bounds.max[1] - bounds.min[1],
    depth: bounds.max[2] - bounds.min[2],
  };
}

/** Null means usable without scaling; any reason requires a labelled dimension proxy. */
export function projectModelCompatibility(
  object: { variantId: string; dimensions: Dimensions },
  asset: CatalogueAsset,
  product: CatalogueProductSelection,
  variant: CatalogueVariantSelection,
  stale: boolean,
): string | null {
  if (asset.kind !== 'model') return 'This asset is a product photograph.';
  if (
    stale ||
    object.variantId !== variant.id ||
    !sameCatalogueDimensions(object.dimensions, variant.dimensions)
  )
    return 'Saved furniture dimensions or identity differ from the current catalogue.';
  if (asset.productId !== product.id || (asset.variantId !== null && asset.variantId !== variant.id))
    return 'This model belongs to another product variant.';
  // A parent model is only transferable to an equal-size variant. Export tolerance is
  // for measured meshes, not a licence to use a different catalogue size.
  if (asset.variantId === null && !sameCatalogueDimensions(product.dimensions, variant.dimensions))
    return 'The product model was validated for a differently sized parent product.';
  const bounds = modelBoundsFromValidation(asset.validation);
  if (!bounds || !asset.dimensions || asset.validation.units !== 'metres')
    return 'Validated metre-based model bounds are unavailable.';
  const measured = modelDimensionsFromBounds(bounds);
  if (
    !sameCatalogueDimensions(asset.dimensions, object.dimensions) ||
    !dimensionsWithinModelTolerance(measured, object.dimensions)
  )
    return 'Measured model bounds no longer match the selected dimensions.';
  return null;
}

export type ObjectModelResolution =
  | {
      kind: 'model';
      asset: ProjectCatalogueAsset;
      bounds: ValidatedModelBounds;
      measuredDimensions: Dimensions;
    }
  | { kind: 'proxy'; reason: string };

/** Stable variant-first resolution from an authorised selected-project asset response. */
export function resolveObjectModel(
  object: { variantId: string; dimensions: Dimensions },
  assets: ProjectCatalogueAsset[],
): ObjectModelResolution {
  const candidates = assets
    .filter((asset) => asset.kind === 'model')
    .sort(
      (a, b) =>
        Number(b.variantId === object.variantId) - Number(a.variantId === object.variantId) ||
        a.id.localeCompare(b.id),
    );
  let reason = 'No validated matching model is available; showing catalogue dimensions.';
  for (const asset of candidates) {
    if (!asset.modelRenderable) {
      if (asset.proxyReason) reason = asset.proxyReason;
      continue;
    }
    if (!asset.url || (asset.variantId !== null && asset.variantId !== object.variantId)) continue;
    const bounds = modelBoundsFromValidation(asset.validation);
    if (!bounds || !asset.dimensions || asset.validation.units !== 'metres') continue;
    const measuredDimensions = modelDimensionsFromBounds(bounds);
    if (
      !sameCatalogueDimensions(asset.dimensions, object.dimensions) ||
      !dimensionsWithinModelTolerance(measuredDimensions, object.dimensions)
    )
      continue;
    return { kind: 'model', asset, bounds, measuredDimensions };
  }
  return { kind: 'proxy', reason };
}
