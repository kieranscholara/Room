import 'server-only';
import { createHash } from 'node:crypto';
import { priceQuotation, PricingError } from '@roomsell/pricing';
import { adminClient, databaseError, membership } from './supabase-server';
import { projectContext } from './project-service';
import { ServiceError } from './editor-service';
import { uuid } from './account-schemas';
import {
  policyWriteSchema,
  quotationIssueSchema,
  quotationPreviewSchema,
  quotationSourceSchema,
  quotationSnapshotSchema,
  type IssuedQuotation,
  type RetailerPricingPolicy,
} from './quotation-schemas';

interface QuotationRow {
  id: string;
  organisation_id: string;
  project_id: string;
  scene_id: string;
  scene_version: number;
  policy_revision: number;
  number: string;
  issued_at: string;
  issued_by: string;
  request_hash: string;
  snapshot: unknown;
}

function issuedDto(row: QuotationRow): IssuedQuotation {
  const parsed = quotationSnapshotSchema.safeParse(row.snapshot);
  if (
    !parsed.success ||
    parsed.data.source.sceneId !== row.scene_id ||
    parsed.data.source.sceneVersion !== row.scene_version ||
    parsed.data.source.policyRevision !== row.policy_revision ||
    parsed.data.source.retailer.id !== row.organisation_id ||
    parsed.data.source.project.id !== row.project_id
  )
    throw new ServiceError(500, 'Stored quotation integrity could not be verified.');
  return {
    id: row.id,
    organisationId: row.organisation_id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    sceneVersion: row.scene_version,
    policyRevision: row.policy_revision,
    number: row.number,
    issuedAt: row.issued_at,
    snapshot: parsed.data,
  };
}

export async function getRetailerPricing(orgId: string): Promise<RetailerPricingPolicy | null> {
  uuid.parse(orgId);
  const { client } = await membership(orgId, ['owner', 'admin', 'salesperson', 'designer']);
  const result = await client
    .from('retailer_pricing_policies')
    .select('revision,policy,updated_at')
    .eq('organisation_id', orgId)
    .maybeSingle();
  databaseError(result.error);
  return result.data
    ? {
        revision: result.data.revision,
        policy: policyWriteSchema.shape.policy.parse(result.data.policy),
        updatedAt: result.data.updated_at,
      }
    : null;
}

export async function setRetailerPricing(orgId: string, input: unknown): Promise<RetailerPricingPolicy> {
  uuid.parse(orgId);
  const request = policyWriteSchema.parse(input);
  const { user } = await membership(orgId, ['owner', 'admin']);
  const result = await adminClient().rpc('set_retailer_pricing_policy', {
    p_org_id: orgId,
    p_actor_id: user.id,
    p_expected_revision: request.expectedRevision,
    p_policy: request.policy,
  });
  databaseError(result.error);
  return result.data as RetailerPricingPolicy;
}

async function staffProject(projectId: string) {
  const context = await projectContext(projectId);
  if (context.role === 'customer')
    throw new ServiceError(403, 'Only retailer staff can price or issue quotations.');
  return context;
}

async function pricingPreview(
  projectId: string,
  actorId: string,
  request: ReturnType<typeof quotationPreviewSchema.parse>,
) {
  const result = await adminClient().rpc('quotation_source', {
    p_project_id: projectId,
    p_actor_id: actorId,
    p_expected_scene_version: request.expectedSceneVersion,
    p_expected_policy_revision: request.expectedPolicyRevision,
  });
  databaseError(result.error);
  const parsed = quotationSourceSchema.safeParse(result.data);
  if (!parsed.success) throw new ServiceError(500, 'Authoritative quotation source could not be verified.');
  const source = parsed.data;
  try {
    const calculation = priceQuotation({
      policy: source.policy,
      items: source.items.map(({ variantId, sku, name, quantity, unitPriceMinor, currency }) => ({
        variantId,
        sku,
        name,
        quantity,
        unitPriceMinor,
        currency,
      })),
    });
    const sourceFingerprint = createHash('sha256').update(JSON.stringify(source)).digest('hex');
    return { source, calculation, sourceFingerprint };
  } catch (error) {
    if (error instanceof PricingError) throw new ServiceError(422, error.message);
    throw error;
  }
}

export async function previewQuotation(projectId: string, input: unknown) {
  const request = quotationPreviewSchema.parse(input);
  const context = await staffProject(projectId);
  return pricingPreview(projectId, context.user.id, request);
}

export async function issueQuotation(projectId: string, input: unknown): Promise<IssuedQuotation> {
  const request = quotationIssueSchema.parse(input);
  const context = await staffProject(projectId);
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        projectId,
        expectedSceneVersion: request.expectedSceneVersion,
        expectedPolicyRevision: request.expectedPolicyRevision,
        expectedSourceFingerprint: request.expectedSourceFingerprint,
      }),
    )
    .digest('hex');
  // Return the original issued result on a retry, even after catalogue/policy changes.
  // SQL repeats this check under the organisation lock for concurrent requests.
  const existing = await context.client
    .from('quotations')
    .select('*')
    .eq('project_id', projectId)
    .eq('idempotency_key', request.idempotencyKey)
    .maybeSingle();
  databaseError(existing.error);
  if (existing.data) {
    if (existing.data.issued_by !== context.user.id || existing.data.request_hash !== requestHash)
      throw new ServiceError(409, 'This issuance key was used for a different request.');
    return issuedDto(existing.data as QuotationRow);
  }
  const { source, calculation, sourceFingerprint } = await pricingPreview(
    projectId,
    context.user.id,
    request,
  );
  if (sourceFingerprint !== request.expectedSourceFingerprint)
    throw new ServiceError(
      409,
      'Catalogue prices or quotation details changed. Preview and review the quotation again.',
    );
  const result = await adminClient().rpc('issue_quotation', {
    p_project_id: projectId,
    p_actor_id: context.user.id,
    p_expected_scene_version: request.expectedSceneVersion,
    p_expected_policy_revision: request.expectedPolicyRevision,
    p_idempotency_key: request.idempotencyKey,
    p_request_hash: requestHash,
    p_source: source,
    p_calculation: calculation,
  });
  databaseError(result.error);
  return issuedDto(result.data as QuotationRow);
}

export async function listQuotations(projectId: string): Promise<IssuedQuotation[]> {
  const context = await projectContext(projectId);
  const result = await context.client
    .from('quotations')
    .select('*')
    .eq('project_id', projectId)
    .order('issued_at', { ascending: false })
    .order('id')
    .limit(50);
  databaseError(result.error);
  return (result.data || []).map((row) => issuedDto(row as QuotationRow));
}

export async function getQuotation(projectId: string, quotationId: string): Promise<IssuedQuotation> {
  uuid.parse(quotationId);
  const context = await projectContext(projectId);
  const result = await context.client
    .from('quotations')
    .select('*')
    .eq('project_id', projectId)
    .eq('id', quotationId)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Issued quotation not found in this project.');
  return issuedDto(result.data as QuotationRow);
}
