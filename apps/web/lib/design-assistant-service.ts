import 'server-only';
import sharp from 'sharp';
import { sceneSchema } from '@roomsell/scene-core';
import {
  catalogueObjectMatches,
  catalogueProductSelectionFromRow,
  catalogueVariantSelectionFromRow,
  isCatalogueVariantAvailable,
} from '@roomsell/catalogue';
import { pricingPolicySchema } from '@roomsell/pricing';
import {
  assistantRequestSchema,
  testAssistantIntent,
  validateAssistantIntent,
  type AssistantCandidate,
} from './assistant-contract';
import { openAiDesign, openAiConfigured } from './ai-provider';
import { testingEnabled } from './local-testing';
import { adminClient, databaseError } from './supabase-server';
import { projectContext, projectEditor, type ProjectContext } from './project-service';
import { ServiceError } from './editor-service';
import { enqueueJob, type TenantJob } from './jobs-service';

export async function assistantStatus() {
  return { openAiConfigured: openAiConfigured(), testAdapterEnabled: testingEnabled() };
}
export async function queueDesignAssistance(projectId: string, input: unknown) {
  const request = assistantRequestSchema.parse(input),
    context = await projectContext(projectId, true);
  if (request.provider === 'test' && !testingEnabled())
    throw new ServiceError(
      403,
      'The test assistant is available only in the explicit local test environment.',
    );
  if (request.provider === 'openai' && !openAiConfigured())
    throw new ServiceError(503, 'Configure the OpenAI API key securely before using live AI.');
  const scene = await (await projectEditor(context)).read();
  if (scene.scene.version !== request.expectedSceneVersion)
    throw new ServiceError(409, 'Scene changed; review the current design.');
  return enqueueJob(
    context.project.organisation_id,
    projectId,
    context.user.id,
    'ai_design',
    request as unknown as Record<string, unknown>,
    request.idempotencyKey,
  );
}
export async function workerProjectContext(projectId: string, actorId: string): Promise<ProjectContext> {
  const admin = adminClient();
  const permission = await admin.rpc('actor_can_edit_project', {
    p_project_id: projectId,
    p_actor_id: actorId,
  });
  databaseError(permission.error);
  if (!permission.data) throw new ServiceError(403, 'Project edit access was revoked.');
  const result = await admin.from('projects').select('*').eq('id', projectId).single();
  databaseError(result.error);
  const member = await admin
    .from('organisation_members')
    .select('role')
    .eq('organisation_id', result.data.organisation_id)
    .eq('user_id', actorId)
    .single();
  databaseError(member.error);
  if (!member.data) throw new ServiceError(403, 'Project membership was revoked.');
  const auth = await admin.auth.admin.getUserById(actorId);
  if (auth.error || !auth.data.user) throw new ServiceError(403, 'Job identity is unavailable.');
  return { client: admin, user: auth.data.user, project: result.data, role: member.data.role, canEdit: true };
}
export async function executeDesignJob(job: TenantJob) {
  if (!job.project_id) throw new ServiceError(400, 'A project is required for design assistance.');
  const request = assistantRequestSchema.parse(job.payload);
  if (request.provider === 'test' && !testingEnabled())
    throw new ServiceError(403, 'The local test assistant is disabled.');
  const context = await workerProjectContext(job.project_id, job.actor_id),
    editor = await projectEditor(context),
    state = await editor.read(),
    scene = state.scene;
  if (scene.version !== request.expectedSceneVersion)
    throw new ServiceError(409, 'The saved design changed; request fresh assistance.');
  const admin = adminClient();
  const [catalogue, policyResult] = await Promise.all([
    admin
      .from('product_variants')
      .select('*,product:products(*)')
      .eq('organisation_id', job.organisation_id)
      .order('id')
      .limit(200),
    admin
      .from('retailer_pricing_policies')
      .select('policy,revision')
      .eq('organisation_id', job.organisation_id)
      .maybeSingle(),
  ]);
  databaseError(catalogue.error);
  databaseError(policyResult.error);
  if (!policyResult.data)
    throw new ServiceError(422, 'Configure retailer pricing before budget-based recommendations.');
  const policy = pricingPolicySchema.parse(policyResult.data.policy);
  const selectedIds = scene.objects.map((object) => object.variantId);
  if (selectedIds.length) {
    const savedRows = await admin
      .from('product_variants')
      .select('*,product:products(*)')
      .eq('organisation_id', job.organisation_id)
      .in('id', selectedIds);
    databaseError(savedRows.error);
    for (const row of savedRows.data ?? [])
      if (!catalogue.data?.some((item) => item.id === row.id)) catalogue.data?.push(row);
  }
  const permittedRows =
    context.role === 'customer'
      ? (catalogue.data ?? []).filter((row) => selectedIds.includes(row.id))
      : (catalogue.data ?? []);
  const stock = await admin.rpc('available_variant_stocks', {
    p_variant_ids: permittedRows.map((row) => row.id),
  });
  databaseError(stock.error);
  const candidates: AssistantCandidate[] = [];
  for (const row of permittedRows) {
    const productRow = Array.isArray(row.product) ? row.product[0] : row.product;
    if (!productRow) continue;
    const product = catalogueProductSelectionFromRow(productRow),
      variant = catalogueVariantSelectionFromRow(row);
    if (!isCatalogueVariantAvailable(product, variant) || product.currency !== context.project.currency)
      continue;
    candidates.push({
      variantId: variant.id,
      productId: product.id,
      sku: variant.sku,
      name: product.name,
      variantName: row.name,
      category: product.category,
      currency: product.currency,
      priceMinor: Number(row.price_minor),
      dimensions: variant.dimensions,
      color: variant.color,
      availability: variant.availability as 'in_stock' | 'made_to_order',
      stockQuantity: Number(stock.data?.[variant.id] ?? 0),
    });
  }
  for (const object of scene.objects) {
    const row = (catalogue.data ?? []).find((candidate) => candidate.id === object.variantId),
      productRow = row && (Array.isArray(row.product) ? row.product[0] : row.product);
    if (
      !row ||
      !productRow ||
      !catalogueObjectMatches(
        object,
        catalogueProductSelectionFromRow(productRow),
        catalogueVariantSelectionFromRow(row),
      )
    )
      throw new ServiceError(409, 'Saved furniture needs catalogue review before recommendations.');
  }
  const photos: { mimeType: string; base64: string }[] = [];
  if (request.referenceIds.length && request.provider === 'openai') {
    const references = await admin
      .from('room_references')
      .select('id,path')
      .eq('project_id', job.project_id)
      .eq('organisation_id', job.organisation_id)
      .in('id', request.referenceIds);
    databaseError(references.error);
    if (references.data?.length !== request.referenceIds.length)
      throw new ServiceError(404, 'A selected private reference is no longer available.');
    for (const reference of references.data) {
      const download = await admin.storage.from('room-references').download(reference.path);
      if (download.error || !download.data)
        throw new ServiceError(404, 'Room photograph content unavailable.');
      const bytes = await sharp(Buffer.from(await download.data.arrayBuffer()), {
        limitInputPixels: 40000000,
      })
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      if (bytes.length > 1024 * 1024) throw new ServiceError(422, 'Prepared AI reference is too large.');
      photos.push({ mimeType: 'image/jpeg', base64: bytes.toString('base64') });
    }
  }
  const budgetMinor = Math.min(
    Number(context.project.budget_minor),
    request.budgetMinor ?? Number(context.project.budget_minor),
  );
  const intention =
    request.provider === 'test'
      ? testAssistantIntent(scene, candidates, policy, budgetMinor)
      : await openAiDesign({
          brief: request.brief,
          scene: sceneSchema.parse(scene),
          candidates,
          policy,
          budgetMinor,
          photos,
        });
  if (context.role === 'customer' && intention.recommendations.length)
    throw new ServiceError(
      422,
      'Customer assistance can rearrange selected furniture; catalogue additions require retailer approval.',
    );
  const freshContext = await workerProjectContext(job.project_id, job.actor_id);
  const freshState = await (await projectEditor(freshContext)).read();
  if (freshState.scene.version !== scene.version)
    throw new ServiceError(409, 'Design changed while assistance was running; request fresh advice.');
  const ids = permittedRows.map((row) => row.id);
  const [freshCatalogue, freshPolicy, freshStock] = await Promise.all([
    admin
      .from('product_variants')
      .select('id,updated_at,product:products(updated_at)')
      .eq('organisation_id', job.organisation_id)
      .in('id', ids),
    admin
      .from('retailer_pricing_policies')
      .select('revision')
      .eq('organisation_id', job.organisation_id)
      .single(),
    admin.rpc('available_variant_stocks', { p_variant_ids: ids }),
  ]);
  for (const result of [freshCatalogue, freshPolicy, freshStock]) databaseError(result.error);
  const sourceChanged =
    freshCatalogue.data?.length !== permittedRows.length ||
    permittedRows.some((row) => {
      const fresh = freshCatalogue.data?.find((item) => item.id === row.id);
      const before = Array.isArray(row.product) ? row.product[0] : row.product;
      const after = fresh && (Array.isArray(fresh.product) ? fresh.product[0] : fresh.product);
      return (
        !fresh ||
        fresh.updated_at !== row.updated_at ||
        before?.updated_at !== after?.updated_at ||
        Number(freshStock.data?.[row.id] ?? 0) !== Number(stock.data?.[row.id] ?? 0)
      );
    });
  if (
    sourceChanged ||
    freshPolicy.data?.revision !== policyResult.data.revision ||
    freshContext.project.budget_minor !== context.project.budget_minor
  )
    throw new ServiceError(
      409,
      'Catalogue, stock, budget or pricing changed during assistance; request fresh advice.',
    );
  let checked;
  try {
    checked = validateAssistantIntent(intention, scene, candidates, policy, budgetMinor);
  } catch (error) {
    throw new ServiceError(
      422,
      error instanceof Error ? error.message : 'The assistant intent failed catalogue and budget checks.',
    );
  }
  let proposal = null;
  if (checked.operation) {
    const response = await editor.execute({
      action: 'preview',
      expectedVersion: scene.version,
      operation: checked.operation,
    });
    if ('proposal' in response) proposal = response.proposal;
  }
  return {
    provider: request.provider,
    fictionalAdapter: request.provider === 'test',
    summary: checked.intent.summary,
    baseVersion: scene.version,
    recommendations: checked.recommendations,
    calculation: checked.calculation,
    overBudget: checked.overBudget,
    proposal,
  };
}
