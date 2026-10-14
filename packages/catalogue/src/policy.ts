import type { CatalogueAsset, CatalogueProduct, CatalogueVariant, Dimensions } from './index';

export type CatalogueCategory = CatalogueProduct['category'];
export type CatalogueAvailability = CatalogueVariant['availability'];
export type ProductVariantView = Omit<CatalogueVariant, 'productId' | 'organisationId'>;
export type CatalogueProductView = Omit<CatalogueProduct, 'variants'> & { variants: ProductVariantView[] };

export interface CatalogueProductSelection {
  id: string;
  organisationId: string;
  name: string;
  category: CatalogueCategory;
  currency: string;
  dimensions: Dimensions;
  active: boolean;
  availability: CatalogueAvailability;
}
export interface CatalogueVariantSelection {
  id: string;
  productId: string;
  organisationId: string;
  sku: string;
  color: string;
  dimensions: Dimensions;
  active: boolean;
  availability: CatalogueAvailability;
  stockQuantity: number;
}
const rowDimensions = (row: Record<string, unknown>): Dimensions => ({
  width: Number(row.width_m),
  depth: Number(row.depth_m),
  height: Number(row.height_m),
});
/** Converts database column names once; caller still verifies tenant access through its RLS context. */
export function catalogueProductSelectionFromRow(row: Record<string, unknown>): CatalogueProductSelection {
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    name: String(row.name),
    category: row.category as CatalogueCategory,
    currency: String(row.currency),
    dimensions: rowDimensions(row),
    active: Boolean(row.active),
    availability: row.availability as CatalogueAvailability,
  };
}
export function catalogueVariantSelectionFromRow(row: Record<string, unknown>): CatalogueVariantSelection {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    organisationId: String(row.organisation_id),
    sku: String(row.sku),
    color: String(row.color),
    dimensions: rowDimensions(row),
    active: Boolean(row.active),
    availability: row.availability as CatalogueAvailability,
    stockQuantity: Number(row.stock_quantity),
  };
}
/** Made-to-order does not require on-hand stock. Parent availability remains authoritative. */
export function isCatalogueVariantAvailable(
  product: Pick<CatalogueProductSelection, 'active' | 'availability'>,
  variant: Pick<CatalogueVariantSelection, 'active' | 'availability' | 'stockQuantity'>,
) {
  return (
    product.active &&
    variant.active &&
    product.availability !== 'out_of_stock' &&
    variant.availability !== 'out_of_stock' &&
    (variant.availability !== 'in_stock' || variant.stockQuantity > 0)
  );
}
export function sameCatalogueDimensions(a: Dimensions, b: Dimensions) {
  return a.width === b.width && a.depth === b.depth && a.height === b.height;
}
export interface CatalogueSceneObject {
  variantId: string;
  sku: string;
  name: string;
  category: CatalogueCategory;
  color: string;
  solid: boolean;
  dimensions: Dimensions;
}
/** Geometry and displayed identity must match the authoritative selected variant exactly. */
export function catalogueObjectMatches(
  object: CatalogueSceneObject,
  product: Pick<CatalogueProductSelection, 'name' | 'category'>,
  variant: Pick<CatalogueVariantSelection, 'id' | 'sku' | 'color' | 'dimensions'>,
) {
  return (
    object.variantId === variant.id &&
    object.sku === variant.sku &&
    object.name === product.name &&
    object.category === product.category &&
    object.color === variant.color &&
    object.solid === (product.category !== 'rug') &&
    sameCatalogueDimensions(object.dimensions, variant.dimensions)
  );
}

export interface ProjectCatalogueAsset extends CatalogueAsset {
  modelRenderable: boolean;
  proxyReason: string | null;
}
export interface SelectedProjectProductItem {
  objectId: string;
  variantId: string;
  sku: string;
  name: string;
  variantName: string | null;
  priceMinor: number | null;
  currency: string;
  available: boolean;
  stale: boolean;
  assets: ProjectCatalogueAsset[];
}
export interface SelectedProjectProducts {
  items: SelectedProjectProductItem[];
  totalMinor: number | null;
  budgetMinor: number;
  currency: string;
  stale: boolean;
  overBudget: boolean | null;
}
