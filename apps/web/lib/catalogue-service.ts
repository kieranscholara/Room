import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  normaliseProductInput,
  parseCatalogueCsv,
  productSchema,
  type CatalogueProduct,
  type CatalogueAsset,
  type Dimensions,
} from '@roomsell/catalogue';
import { validateProductAsset, AssetValidationError } from '@roomsell/catalogue/assets';
import { ServiceError } from './editor-service';
import { adminClient, databaseError, membership } from './supabase-server';
import { assertSameOrigin } from './http-api';
import { uuid } from './account-schemas';

export const catalogueStaff = ['owner', 'admin', 'salesperson', 'designer'] as const;
const managers = ['owner', 'admin'] as const;
interface InventoryRow {
  id: string;
  organisation_id: string;
  sku: string;
  name: string;
  price_minor: number;
  width_m: number;
  depth_m: number;
  height_m: number;
  color: string;
  material: string;
  active: boolean;
  availability: string;
  stock_quantity: number;
  lead_time_days: number;
}
interface VariantRow extends InventoryRow {
  product_id: string;
}
interface AssetRow {
  id: string;
  organisation_id: string;
  product_id: string;
  variant_id: string | null;
  path: string;
  kind: 'image' | 'model';
  mime_type: CatalogueAsset['mimeType'];
  size_bytes: number;
  width_m: number | null;
  depth_m: number | null;
  height_m: number | null;
  validation: Record<string, unknown>;
  status: string;
}
interface ProductRow extends InventoryRow {
  category: string;
  currency: string;
  product_variants: VariantRow[];
  product_assets: AssetRow[];
}
function inventory(row: InventoryRow) {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    sku: row.sku,
    name: row.name,
    priceMinor: Number(row.price_minor),
    dimensions: { width: Number(row.width_m), depth: Number(row.depth_m), height: Number(row.height_m) },
    color: row.color,
    material: row.material,
    active: row.active,
    availability: row.availability,
    stockQuantity: row.stock_quantity,
    leadTimeDays: row.lead_time_days,
  };
}
export async function catalogueAssetDto(row: AssetRow): Promise<CatalogueAsset> {
  const asset: CatalogueAsset = {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    dimensions:
      row.kind === 'model'
        ? { width: Number(row.width_m), depth: Number(row.depth_m), height: Number(row.height_m) }
        : null,
    validation: row.validation,
  };
  asset.url = `/api/organisations/${row.organisation_id}/catalogue/${row.product_id}/assets/${row.id}`;
  return asset;
}
async function productDto(row: ProductRow): Promise<CatalogueProduct> {
  return productSchema.parse({
    ...inventory(row),
    category: row.category,
    currency: row.currency,
    variants: row.product_variants.map((variant) => ({
      ...inventory(variant),
      productId: variant.product_id,
    })),
    assets: await Promise.all(
      row.product_assets.filter((asset) => asset.status === 'validated').map(catalogueAssetDto),
    ),
  });
}
export async function listCatalogue(
  orgId: string,
  options: { query?: string; category?: string; active?: string; offset?: number } = {},
) {
  const { client } = await membership(orgId, catalogueStaff);
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000)
    throw new ServiceError(400, 'Invalid catalogue offset.');
  let query = client
    .from('products')
    .select('*,product_variants(*),product_assets(*)')
    .eq('organisation_id', orgId);
  if (options.category) {
    if (!['bed', 'wardrobe', 'bedside', 'rug', 'desk'].includes(options.category))
      throw new ServiceError(400, 'Invalid category.');
    query = query.eq('category', options.category);
  }
  if (options.active) {
    if (!['true', 'false'].includes(options.active)) throw new ServiceError(400, 'Invalid active filter.');
    query = query.eq('active', options.active === 'true');
  }
  if (options.query) {
    if (options.query.length > 100) throw new ServiceError(400, 'Search is too long.');
    // A generated search column covers names and SKUs in one ordered query.
    // ILIKE receives a value; user input never becomes a filter expression.
    const pattern = `%${options.query.replace(/[\\%_]/g, '\\$&')}%`;
    query = query.ilike('search_document', pattern);
  }
  const result = await query
    .order('name')
    .order('id')
    .range(offset, offset + 99);
  databaseError(result.error);
  return Promise.all(((result.data as ProductRow[]) || []).map(productDto));
}
export async function getCatalogueProduct(orgId: string, productId: string) {
  const { client } = await membership(orgId, catalogueStaff);
  const result = await client
    .from('products')
    .select('*,product_variants(*),product_assets(*)')
    .eq('organisation_id', orgId)
    .eq('id', productId)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Product not found.');
  return productDto(result.data as ProductRow);
}
export async function writeCatalogueProduct(orgId: string, input: unknown, productId: string | null) {
  const { user, client } = await membership(orgId, managers);
  const product = normaliseProductInput(input);
  // Preserve a default variant identity when a single-variant product is edited
  // through the simple form. Explicit variants always keep their supplied IDs.
  if (productId && !(input as { variants?: unknown[] }).variants?.length) {
    const current = await client
      .from('product_variants')
      .select('id,sku')
      .eq('organisation_id', orgId)
      .eq('product_id', productId)
      .eq('active', true);
    databaseError(current.error);
    if (current.data?.length === 1) product.variants[0].id = current.data[0].id;
  }
  const saved = await adminClient().rpc('catalogue_product_write', {
    p_org_id: orgId,
    p_actor_id: user.id,
    p_product_id: productId,
    p_product: product,
  });
  databaseError(saved.error);
  return getCatalogueProduct(orgId, saved.data as string);
}
export async function archiveCatalogueProduct(orgId: string, productId: string) {
  const { user } = await membership(orgId, managers);
  const result = await adminClient().rpc('catalogue_archive_product', {
    p_org_id: orgId,
    p_actor_id: user.id,
    p_product_id: productId,
  });
  databaseError(result.error);
  return getCatalogueProduct(orgId, productId);
}

/** Read the entire multipart body only after enforcing a streaming byte bound. */
export async function boundedMultipart(request: NextRequest, limit: number) {
  assertSameOrigin(request);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;'))
    throw new ServiceError(415, 'Multipart form data is required.');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new ServiceError(413, 'Upload is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError(400, 'An upload is required.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ServiceError(413, 'Upload is too large.');
    }
    chunks.push(value);
  }
  try {
    const body = Buffer.concat(chunks);
    return await new Request('http://upload.invalid', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }).formData();
  } catch {
    throw new ServiceError(400, 'Invalid multipart form data.');
  }
}
function uploadedFile(form: FormData, permittedFields: readonly string[], maxBytes: number) {
  for (const key of form.keys())
    if (!permittedFields.includes(key) || form.getAll(key).length !== 1)
      throw new ServiceError(400, 'Unexpected or repeated upload field.');
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new ServiceError(400, 'Choose a nonempty file.');
  if (file.size > maxBytes) throw new ServiceError(413, 'Upload is too large.');
  if (!file.name || file.name.length > 255) throw new ServiceError(400, 'Invalid file name.');
  return file;
}
export async function importCatalogue(orgId: string, request: NextRequest) {
  const { user } = await membership(orgId, managers);
  const form = await boundedMultipart(request, 1024 * 1024 + 16 * 1024);
  const file = uploadedFile(form, ['file'], 1024 * 1024);
  const parsed = parseCatalogueCsv(new Uint8Array(await file.arrayBuffer()));
  const result = await adminClient().rpc('catalogue_import_products', {
    p_org_id: orgId,
    p_actor_id: user.id,
    p_file_name: file.name,
    p_products: parsed.products,
    p_row_count: Math.min(parsed.rowCount, 500),
    p_errors: parsed.errors,
  });
  databaseError(result.error);
  return result.data as { id: string; status: 'failed' | 'completed'; summary: Record<string, unknown> };
}
export async function catalogueImports(orgId: string) {
  const { client } = await membership(orgId, managers);
  const result = await client
    .from('catalogue_imports')
    .select('id,file_name,status,summary,created_at')
    .eq('organisation_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  databaseError(result.error);
  return result.data?.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    status: row.status,
    summary: row.summary,
    createdAt: row.created_at,
  }));
}
export async function uploadCatalogueAsset(orgId: string, productId: string, request: NextRequest) {
  const { user } = await membership(orgId, managers);
  const form = await boundedMultipart(request, 20 * 1024 * 1024 + 16 * 1024);
  const file = uploadedFile(form, ['file', 'variantId'], 20 * 1024 * 1024);
  const rawVariant = form.get('variantId');
  const variantId = rawVariant ? uuid.parse(rawVariant) : null;
  const product = await getCatalogueProduct(orgId, productId);
  let expectedDimensions: Dimensions = product.dimensions;
  if (variantId) {
    const variant = product.variants.find((item) => item.id === variantId);
    if (!variant) throw new ServiceError(403, 'Variant does not belong to this product.');
    expectedDimensions = variant.dimensions;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let validated;
  try {
    validated = await validateProductAsset(bytes, { fileName: file.name, expectedDimensions });
  } catch (error) {
    if (error instanceof AssetValidationError) throw new ServiceError(422, error.message);
    throw error;
  }
  const path = `${orgId}/${productId}/${randomUUID()}`;
  const admin = adminClient();
  const uploaded = await admin.storage.from('product-assets').upload(path, bytes, {
    contentType: validated.mimeType,
    upsert: false,
    cacheControl: '300',
  });
  if (uploaded.error) throw new ServiceError(500, 'Unable to store the validated asset.');
  try {
    const registered = await admin.rpc('catalogue_register_asset', {
      p_org_id: orgId,
      p_actor_id: user.id,
      p_product_id: productId,
      p_variant_id: variantId,
      p_asset: {
        ...validated,
        path,
        ...(validated.kind === 'model' ? { dimensions: expectedDimensions } : {}),
      },
    });
    databaseError(registered.error);
    return await catalogueAssetDto(registered.data as AssetRow);
  } catch (error) {
    // An unlinked staged object is unreadable under Storage RLS even if cleanup
    // is temporarily unavailable. Its generated path is never returned.
    await admin.storage.from('product-assets').remove([path]);
    throw error;
  }
}
export async function removeCatalogueAsset(orgId: string, productId: string, assetId: string) {
  const { user } = await membership(orgId, managers);
  const admin = adminClient();
  const removed = await admin.rpc('catalogue_remove_asset', {
    p_org_id: orgId,
    p_actor_id: user.id,
    p_product_id: productId,
    p_asset_id: assetId,
  });
  databaseError(removed.error);
  const cleanup = await admin.storage.from('product-assets').remove([removed.data as string]);
  return { removed: true, storageCleanupPending: Boolean(cleanup.error) };
}

export async function downloadCatalogueAsset(orgId: string, productId: string, assetId: string) {
  const { client } = await membership(orgId, catalogueStaff);
  const result = await client
    .from('product_assets')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('product_id', productId)
    .eq('id', assetId)
    .eq('status', 'validated')
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Validated asset not found.');
  const row = result.data as AssetRow;
  const download = await adminClient().storage.from('product-assets').download(row.path);
  if (download.error || !download.data) throw new ServiceError(404, 'Asset content is unavailable.');
  return new Response(download.data.stream(), {
    headers: {
      'Content-Type': row.mime_type,
      'Content-Length': String(row.size_bytes),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': row.kind === 'image' ? 'inline' : 'attachment',
    },
  });
}
