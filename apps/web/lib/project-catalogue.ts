import 'server-only';
import { sceneSchema, type Scene } from '@roomsell/scene-core';
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

function matchesObject(
  object: Scene['objects'][number],
  variant: Record<string, unknown>,
  product: Record<string, unknown>,
) {
  return (
    object.sku === variant.sku &&
    object.name === product.name &&
    object.category === product.category &&
    object.color === variant.color &&
    object.solid === (product.category !== 'rug') &&
    object.dimensions.width === Number(variant.width_m) &&
    object.dimensions.depth === Number(variant.depth_m) &&
    object.dimensions.height === Number(variant.height_m)
  );
}

export async function selectedProjectProducts(context: ProjectContext) {
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
    const variant = variants.find((candidate) => candidate.id === object.variantId);
    const product = variant && (Array.isArray(variant.product) ? variant.product[0] : variant.product);
    const currencyMatches = Boolean(product && product.currency === context.project.currency);
    const price = variant && currencyMatches ? Number(variant.price_minor) : null;
    if (price !== null && (!Number.isSafeInteger(price) || price < 0))
      throw new ServiceError(422, 'A catalogue price is outside the supported range.');
    const available = Boolean(
      variant &&
      product &&
      variant.active &&
      product.active &&
      variant.availability !== 'out_of_stock' &&
      product.availability !== 'out_of_stock' &&
      (variant.availability !== 'in_stock' || Number(variant.stock_quantity) > 0),
    );
    return {
      objectId: object.id,
      variantId: object.variantId,
      sku: object.sku,
      name: object.name,
      variantName: variant?.name ?? null,
      priceMinor: price,
      currency: context.project.currency,
      available,
      stale: !variant || !product || !currencyMatches || !matchesObject(object, variant, product),
      assets: (assetResult.data || [])
        .filter(
          (asset) =>
            asset.product_id === variant?.product_id &&
            (!asset.variant_id || asset.variant_id === variant?.id),
        )
        .map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          mimeType: asset.mime_type,
          validation: asset.validation,
          url: `/api/projects/${context.project.id}/assets/${asset.id}`,
        })),
    };
  });
  const sum = items.reduce((total, item) => total + BigInt(item.priceMinor ?? 0), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ServiceError(422, 'The selected product total is outside the supported price range.');
  const totalMinor = items.some((item) => item.priceMinor === null) ? null : Number(sum);
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
