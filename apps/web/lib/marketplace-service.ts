import 'server-only';
import { z } from 'zod';
import { sceneSchema, roomSchema, type Scene, type Request as SceneRequest } from '@roomsell/scene-core';
import { validateScene } from '@roomsell/geometry';
import { priceQuotation, pricingPolicySchema } from '@roomsell/pricing';
import { adminClient, authenticated, databaseError, membership } from './supabase-server';
import {
  EditorService,
  ServiceError,
  parseSavedProposal,
  type Persistence,
  type RecordData,
  type SavedProposal,
} from './editor-service';
import { uuid } from './account-schemas';
export interface PublicOffer {
  id: string;
  organisationId: string;
  retailer: string;
  fictional: boolean;
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  variantName: string;
  category: Scene['objects'][number]['category'];
  dimensions: Scene['objects'][number]['dimensions'];
  color: string;
  currency: string;
  priceMinor: number;
  listedPriceMinor: number;
  availability: string;
  available: boolean;
  revision: number;
  images: { id: string; url: string }[];
}
async function offerDto(row: Record<string, unknown>): Promise<PublicOffer | null> {
  const admin = adminClient();
  const product = await admin
      .from('products')
      .select('*')
      .eq('id', row.product_id)
      .eq('organisation_id', row.organisation_id)
      .maybeSingle(),
    variant = await admin
      .from('product_variants')
      .select('*')
      .eq('id', row.variant_id)
      .eq('organisation_id', row.organisation_id)
      .maybeSingle(),
    org = await admin
      .from('organisations')
      .select('name,is_test,currency')
      .eq('id', row.organisation_id)
      .single(),
    policy = await admin
      .from('retailer_pricing_policies')
      .select('policy')
      .eq('organisation_id', row.organisation_id)
      .maybeSingle();
  for (const result of [product, variant, org, policy]) databaseError(result.error);
  if (!product.data?.active || !variant.data?.active || !policy.data || !org.data) return null;
  const stock = await admin.rpc('available_variant_stock', { p_variant_id: variant.data.id });
  databaseError(stock.error);
  const configured = pricingPolicySchema.parse(policy.data.policy);
  if (configured.currency !== product.data.currency) return null;
  const price = priceQuotation({
    policy: { ...configured, discountBps: 0, deliveryMinor: 0, installationMinor: 0 },
    items: [
      {
        variantId: variant.data.id,
        sku: variant.data.sku,
        name: product.data.name,
        quantity: 1,
        unitPriceMinor: Number(variant.data.price_minor),
        currency: product.data.currency,
      },
    ],
  });
  const imageIds = Array.isArray(row.image_ids) ? (row.image_ids as string[]) : [];
  const assets = imageIds.length
    ? await admin
        .from('product_assets')
        .select('id')
        .in('id', imageIds)
        .eq('organisation_id', row.organisation_id)
        .eq('product_id', row.product_id)
        .eq('kind', 'image')
        .eq('status', 'validated')
    : null;
  if (assets) databaseError(assets.error);
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    retailer: org.data.name,
    fictional: org.data.is_test,
    productId: product.data.id,
    variantId: variant.data.id,
    sku: variant.data.sku,
    name: product.data.name,
    variantName: variant.data.name,
    category: product.data.category,
    dimensions: {
      width: Number(variant.data.width_m),
      depth: Number(variant.data.depth_m),
      height: Number(variant.data.height_m),
    },
    color: variant.data.color,
    currency: product.data.currency,
    priceMinor: price.totals.grandTotalMinor,
    listedPriceMinor: Number(variant.data.price_minor),
    availability: variant.data.availability,
    available:
      product.data.availability !== 'out_of_stock' &&
      variant.data.availability !== 'out_of_stock' &&
      (variant.data.availability !== 'in_stock' || Number(stock.data) > 0),
    revision: Number(row.revision),
    images: (assets?.data ?? []).map((asset) => ({
      id: asset.id,
      url: `/api/marketplace/offers/${row.id}/images/${asset.id}`,
    })),
  };
}
export async function publicOffers(offset = 0, query = '') {
  const result = await adminClient()
    .from('published_offers')
    .select('*')
    .eq('enabled', true)
    .order('id')
    .range(offset, offset + 49);
  databaseError(result.error);
  const items = (await Promise.all((result.data ?? []).map((row) => offerDto(row)))).filter(
    (item): item is PublicOffer => item !== null,
  );
  return items.filter(
    (item) =>
      !query ||
      [item.name, item.retailer, item.sku].some((text) => text.toLowerCase().includes(query.toLowerCase())),
  );
}
export async function publicOffer(id: string) {
  uuid.parse(id);
  const result = await adminClient()
    .from('published_offers')
    .select('*')
    .eq('id', id)
    .eq('enabled', true)
    .maybeSingle();
  databaseError(result.error);
  const item = result.data ? await offerDto(result.data) : null;
  if (!item) throw new ServiceError(404, 'Published offer not found.');
  return item;
}
export async function publicOfferImage(id: string, assetId: string) {
  const item = await publicOffer(id);
  uuid.parse(assetId);
  if (!item.images.some((asset) => asset.id === assetId))
    throw new ServiceError(404, 'Published image not found.');
  const admin = adminClient(),
    asset = await admin
      .from('product_assets')
      .select('path,mime_type')
      .eq('id', assetId)
      .eq('organisation_id', item.organisationId)
      .eq('product_id', item.productId)
      .eq('kind', 'image')
      .eq('status', 'validated')
      .maybeSingle();
  databaseError(asset.error);
  if (!asset.data) throw new ServiceError(404, 'Published image not found.');
  const file = await admin.storage.from('product-assets').download(asset.data.path);
  if (file.error || !file.data) throw new ServiceError(404, 'Published image unavailable.');
  return new Response(file.data.stream(), {
    headers: {
      'Content-Type': asset.data.mime_type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function publications(orgId: string) {
  const { client } = await membership(orgId, ['owner', 'admin']);
  const result = await client
    .from('published_offers')
    .select('id,variant_id,product_id,revision,enabled,image_ids')
    .eq('organisation_id', orgId)
    .order('id');
  databaseError(result.error);
  return result.data ?? [];
}
export async function publishOffer(orgId: string, input: unknown) {
  const request = z
      .object({
        variantId: z.uuid(),
        expectedRevision: z.number().int().nonnegative(),
        enabled: z.boolean(),
        imageIds: z.array(z.uuid()).max(4),
      })
      .strict()
      .parse(input),
    { user } = await membership(orgId, ['owner', 'admin']);
  const result = await adminClient().rpc('publish_offer', {
    p_org_id: orgId,
    p_actor_id: user.id,
    p_variant_id: request.variantId,
    p_expected_revision: request.expectedRevision,
    p_enabled: request.enabled,
    p_image_ids: request.imageIds,
  });
  databaseError(result.error);
  return result.data;
}
const personalInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
    budgetMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    room: roomSchema.refine((room) => room.measurementsConfirmed),
  })
  .strict();
export function consumerDto(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    currency: String(row.currency),
    budgetMinor: Number(row.budget_minor),
    version: Number(row.version),
    createdAt: String(row.created_at),
  };
}
export async function consumerProjects() {
  const { client } = await authenticated();
  const result = await client
    .from('consumer_projects')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  databaseError(result.error);
  return (result.data ?? []).map(consumerDto);
}
export async function createConsumerProject(input: unknown) {
  const request = personalInputSchema.parse(input),
    { user } = await authenticated();
  const scene = sceneSchema.parse({
    schemaVersion: 2,
    id: crypto.randomUUID(),
    organisationId: 'consumer:' + user.id,
    version: 0,
    room: request.room,
    objects: [],
    groups: [],
  });
  const result = await adminClient().rpc('create_consumer_project', {
    p_actor_id: user.id,
    p_name: request.name,
    p_currency: request.currency,
    p_budget_minor: request.budgetMinor,
    p_scene: scene,
  });
  databaseError(result.error);
  return consumerDto(result.data);
}
export async function consumerContext(id: string) {
  uuid.parse(id);
  const { client, user } = await authenticated();
  const result = await client
    .from('consumer_projects')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Personal design not found.');
  return { client, user, project: result.data };
}
async function validateConsumerAddition(
  context: Awaited<ReturnType<typeof consumerContext>>,
  request: SceneRequest,
) {
  if (request.action !== 'preview' || request.operation.type !== 'add-object') return;
  const object = request.operation.object;
  const result = await adminClient()
    .from('published_offers')
    .select('id')
    .eq('variant_id', object.variantId)
    .eq('enabled', true)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(422, 'Choose an explicitly published product.');
  const item = await publicOffer(result.data.id);
  const stock = await adminClient().rpc('available_variant_stock', { p_variant_id: item.variantId });
  databaseError(stock.error);
  const count =
    context.project.data.objects.filter(
      (object: Scene['objects'][number]) => object.variantId === item.variantId,
    ).length + 1;
  if (
    (item.availability === 'in_stock' && Number(stock.data) < count) ||
    !item.available ||
    item.currency !== context.project.currency ||
    object.sku !== item.sku ||
    object.name !== item.name ||
    object.category !== item.category ||
    object.color !== item.color ||
    object.solid !== (item.category !== 'rug') ||
    (['width', 'depth', 'height'] as const).some(
      (axis) => object.dimensions[axis] !== item.dimensions[axis],
    ) ||
    object.follows
  )
    throw new ServiceError(409, 'Published product changed; reload and preview again.');
}
class ConsumerPersistence implements Persistence {
  constructor(private context: Awaited<ReturnType<typeof consumerContext>>) {}
  async load(): Promise<RecordData> {
    const row = await this.context.client
      .from('consumer_projects')
      .select('data,history,future')
      .eq('id', this.context.project.id)
      .single();
    databaseError(row.error);
    if (!row.data) throw new ServiceError(404, 'Personal design not found.');
    return {
      scene: sceneSchema.parse(row.data.data),
      history: (row.data.history as unknown[]).map((value) => sceneSchema.parse(value)),
      future: (row.data.future as unknown[]).map((value) => sceneSchema.parse(value)),
    };
  }
  async save(data: RecordData, expectedVersion?: number) {
    const result = await adminClient().rpc('commit_consumer_scene', {
      p_project_id: this.context.project.id,
      p_actor_id: this.context.user.id,
      p_expected_version: expectedVersion,
      p_scene: data.scene,
      p_history: data.history,
      p_future: data.future,
    });
    databaseError(result.error);
  }
  async saveProposal(saved: SavedProposal) {
    const admin = adminClient();
    const cleanup = await admin
      .from('consumer_proposals')
      .delete()
      .eq('project_id', this.context.project.id)
      .lt('created_at', new Date(Date.now() - 900000).toISOString());
    databaseError(cleanup.error);
    const count = await this.context.client
      .from('consumer_proposals')
      .select('id', { head: true, count: 'exact' })
      .eq('project_id', this.context.project.id);
    databaseError(count.error);
    if ((count.count ?? 0) >= 100) throw new ServiceError(429, 'Too many pending previews.');
    const result = await admin.from('consumer_proposals').insert({
      id: saved.proposal.id,
      project_id: this.context.project.id,
      actor_id: this.context.user.id,
      base_version: saved.proposal.baseVersion,
      payload: saved,
    });
    databaseError(result.error);
  }
  async loadProposal(id: string) {
    const result = await this.context.client
      .from('consumer_proposals')
      .select('payload')
      .eq('id', id)
      .eq('project_id', this.context.project.id)
      .eq('actor_id', this.context.user.id)
      .gte('created_at', new Date(Date.now() - 900000).toISOString())
      .maybeSingle();
    databaseError(result.error);
    if (!result.data) return null;
    const saved = parseSavedProposal(result.data.payload);
    await validateConsumerAddition(this.context, saved.operation);
    return saved;
  }
  async revisions() {
    const result = await this.context.client
      .from('consumer_scene_versions')
      .select('version,data')
      .eq('project_id', this.context.project.id)
      .order('version', { ascending: false })
      .limit(100);
    databaseError(result.error);
    return (result.data ?? []).map((row) => ({ version: row.version, scene: sceneSchema.parse(row.data) }));
  }
}
export async function consumerEditor(id: string, request?: SceneRequest) {
  const context = await consumerContext(id);
  if (request) await validateConsumerAddition(context, request);
  return new EditorService(new ConsumerPersistence(context), sceneSchema.parse(context.project.data));
}
export async function consumerSelectedProducts(id: string) {
  const context = await consumerContext(id),
    scene = sceneSchema.parse(context.project.data);
  const rows = [];
  for (const object of scene.objects) {
    const result = await adminClient()
      .from('published_offers')
      .select('id')
      .eq('variant_id', object.variantId)
      .eq('enabled', true)
      .maybeSingle();
    databaseError(result.error);
    const item = result.data ? await publicOffer(result.data.id).catch(() => null) : null;
    rows.push({
      objectId: object.id,
      variantId: object.variantId,
      sku: object.sku,
      name: object.name,
      variantName: item?.variantName ?? null,
      priceMinor: item?.priceMinor ?? null,
      currency: context.project.currency,
      available: item?.available ?? false,
      stale:
        !item ||
        (['width', 'depth', 'height'] as const).some(
          (axis) => object.dimensions[axis] !== item.dimensions[axis],
        ),
      assets: [],
    });
  }
  const exactTotal = rows.some((item) => item.priceMinor === null)
    ? null
    : rows.reduce((sum, item) => sum + BigInt(item.priceMinor!), 0n);
  const totalMinor =
    exactTotal !== null && exactTotal <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exactTotal) : null;
  return {
    items: rows,
    totalMinor,
    budgetMinor: Number(context.project.budget_minor),
    currency: context.project.currency,
    stale: rows.some((item) => item.stale),
    overBudget: totalMinor === null ? null : totalMinor > Number(context.project.budget_minor),
  };
}
export async function requestRetailerEnquiry(id: string, input: unknown) {
  const request = z
      .object({ organisationId: z.uuid(), expectedVersion: z.number().int().nonnegative() })
      .strict()
      .parse(input),
    context = await consumerContext(id),
    source = sceneSchema.parse(context.project.data);
  if (source.version !== request.expectedVersion)
    throw new ServiceError(409, 'Review the current personal design.');
  const offers = await adminClient()
    .from('published_offers')
    .select('variant_id')
    .eq('organisation_id', request.organisationId)
    .eq('enabled', true);
  databaseError(offers.error);
  const variants = new Set((offers.data ?? []).map((row) => row.variant_id));
  const objects = source.objects
    .filter((object) => variants.has(object.variantId))
    .map((object) => structuredClone(object));
  const ids = new Set(objects.map((object) => object.id));
  for (const object of objects)
    if (object.follows && !ids.has(object.follows.anchorId)) delete object.follows;
  const scene = sceneSchema.parse({
    ...source,
    objects,
    groups: source.groups.filter((group) => group.objectIds.every((objectId) => ids.has(objectId))),
  });
  if (!objects.length || validateScene(scene).length)
    throw new ServiceError(422, 'Select valid available furniture from this retailer before sharing.');
  const result = await adminClient().rpc('marketplace_enquiry', {
    p_consumer_project_id: id,
    p_actor_id: context.user.id,
    p_org_id: request.organisationId,
    p_expected_version: request.expectedVersion,
    p_scene: scene,
  });
  databaseError(result.error);
  return { id: result.data.id, projectId: result.data.retailer_project_id };
}
