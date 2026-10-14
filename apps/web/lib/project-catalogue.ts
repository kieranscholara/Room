import 'server-only';
import { sceneSchema } from '@roomsell/scene-core';
import {
  catalogueObjectMatches,
  catalogueProductSelectionFromRow,
  catalogueVariantSelectionFromRow,
  isCatalogueVariantAvailable,
  nullableCatalogueTotalMinor,
  projectModelCompatibility,
  type CatalogueAsset,
  type ProjectCatalogueAsset,
  type SelectedProjectProducts,
} from '@roomsell/catalogue';
import { adminClient, databaseError } from './supabase-server';
import { ServiceError } from './editor-service';
import type { ProjectContext } from './project-service';

async function selectedCatalogue(context: ProjectContext) {
  const sceneResult = await context.client
    .from('scenes')
    .select('data')
    .eq('project_id', context.project.id)
    .single();
  databaseError(sceneResult.error);
  const scene = sceneSchema.parse(sceneResult.data?.data);
  const ids = [...new Set(scene.objects.map((object) => object.variantId))];
  const admin = adminClient();
  // Customer catalogue access is limited to the products already in this authorised project.
  const result = ids.length
    ? await admin
        .from('product_variants')
        .select('*,product:products(*)')
        .eq('organisation_id', context.project.organisation_id)
        .in('id', ids)
    : { data: [], error: null };
  databaseError(result.error);
  return { scene, variants: result.data || [], admin };
}

export async function selectedProjectProducts(context: ProjectContext): Promise<SelectedProjectProducts> {
  const { scene, variants, admin } = await selectedCatalogue(context);
  const productIds = [...new Set(variants.map((variant) => variant.product_id as string))];
  const assetResult = productIds.length
    ? await admin
        .from('product_assets')
        .select('*')
        .eq('organisation_id', context.project.organisation_id)
        .eq('status', 'validated')
        .in('product_id', productIds)
    : { data: [], error: null };
  databaseError(assetResult.error);
  const items = scene.objects.map((object) => {
    const variantRow = variants.find((candidate) => candidate.id === object.variantId);
    const productRow =
      variantRow && (Array.isArray(variantRow.product) ? variantRow.product[0] : variantRow.product);
    const variant = variantRow && catalogueVariantSelectionFromRow(variantRow);
    const product = productRow && catalogueProductSelectionFromRow(productRow);
    const currencyMatches = Boolean(product && product.currency === context.project.currency);
    const price = variantRow && currencyMatches ? Number(variantRow.price_minor) : null;
    if (price !== null && (!Number.isSafeInteger(price) || price < 0))
      throw new ServiceError(422, 'A catalogue price is outside the supported range.');
    const available = Boolean(variant && product && isCatalogueVariantAvailable(product, variant));
    const stale =
      !variant || !product || !currencyMatches || !catalogueObjectMatches(object, product, variant);
    return {
      objectId: object.id,
      variantId: object.variantId,
      sku: object.sku,
      name: object.name,
      variantName: variantRow?.name ?? null,
      priceMinor: price,
      currency: context.project.currency,
      available,
      stale,
      assets: (assetResult.data || [])
        .filter(
          (asset) =>
            asset.product_id === variant?.productId &&
            (!asset.variant_id || asset.variant_id === variant?.id),
        )
        .map((asset): ProjectCatalogueAsset => {
          const dto: CatalogueAsset = {
            id: asset.id,
            productId: asset.product_id,
            variantId: asset.variant_id,
            kind: asset.kind,
            mimeType: asset.mime_type,
            sizeBytes: Number(asset.size_bytes),
            dimensions:
              asset.kind === 'model'
                ? {
                    width: Number(asset.width_m),
                    depth: Number(asset.depth_m),
                    height: Number(asset.height_m),
                  }
                : null,
            validation: asset.validation,
            url: `/api/projects/${context.project.id}/assets/${asset.id}`,
          };
          const proxyReason =
            variant && product
              ? projectModelCompatibility(object, dto, product, variant, stale)
              : 'The selected catalogue variant is unavailable.';
          return { ...dto, modelRenderable: dto.kind === 'model' && proxyReason === null, proxyReason };
        }),
    };
  });
  let totalMinor: number | null;
  try {
    totalMinor = nullableCatalogueTotalMinor(
      items.map((item) => ({ ...item, quantity: 1 })),
      context.project.currency,
    );
  } catch {
    throw new ServiceError(422, 'The selected product total is outside the supported price range.');
  }
  const budgetMinor = Number(context.project.budget_minor);
  return {
    items,
    totalMinor,
    budgetMinor,
    currency: context.project.currency,
    stale: items.some((item) => item.stale),
    overBudget: totalMinor === null ? null : totalMinor > budgetMinor,
  };
}

export async function selectedProjectAsset(context: ProjectContext, assetId: string) {
  const { variants, admin } = await selectedCatalogue(context);
  const result = await admin
    .from('product_assets')
    .select('*')
    .eq('id', assetId)
    .eq('organisation_id', context.project.organisation_id)
    .eq('status', 'validated')
    .maybeSingle();
  databaseError(result.error);
  const asset = result.data;
  if (
    !asset ||
    !variants.some(
      (variant) =>
        variant.product_id === asset.product_id && (!asset.variant_id || variant.id === asset.variant_id),
    )
  )
    throw new ServiceError(404, 'This asset is not selected in the project.');
  if (asset.bucket !== 'product-assets' || !asset.path.startsWith(`${context.project.organisation_id}/`))
    throw new ServiceError(404, 'Asset not found.');
  const download = await admin.storage.from('product-assets').download(asset.path);
  databaseError(download.error);
  if (!download.data) throw new ServiceError(404, 'Asset not found.');
  return { asset, blob: download.data };
}
