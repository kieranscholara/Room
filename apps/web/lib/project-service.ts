import 'server-only';
import { sceneSchema, requestSchema, type Scene, type Request, type Operation } from '@roomsell/scene-core';
import {
  EditorService,
  ServiceError,
  type Persistence,
  type RecordData,
  type SavedProposal,
} from './editor-service';
import { authenticated, membership, adminClient, databaseError } from './supabase-server';
import { uuid } from './account-schemas';

export async function projectContext(id: string, edit = false) {
  uuid.parse(id);
  const { client, user } = await authenticated();
  const result = await client.from('projects').select('*').eq('id', id).maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Project not found.');
  const project = result.data;
  const member = await membership(project.organisation_id);
  let canEdit = member.role !== 'customer';
  if (!canEdit) {
    const access = await client
      .from('project_access')
      .select('can_edit')
      .eq('project_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    databaseError(access.error);
    canEdit = Boolean(access.data?.can_edit);
  }
  if (edit && !canEdit) throw new ServiceError(403, 'This project is view-only for your account.');
  return { client, user, project, role: member.role, canEdit };
}
export type ProjectContext = Awaited<ReturnType<typeof projectContext>>;
export async function validateCatalogueOperation(context: ProjectContext, operation: Operation) {
  if (operation.type !== 'add-object') return;
  const result = await context.client
    .from('product_variants')
    .select('*, product:products(*)')
    .eq('id', operation.object.variantId)
    .eq('organisation_id', context.project.organisation_id)
    .maybeSingle();
  databaseError(result.error);
  const variant = result.data;
  const product = variant && (Array.isArray(variant.product) ? variant.product[0] : variant.product);
  if (
    !variant ||
    !product ||
    !variant.active ||
    !product.active ||
    variant.availability === 'out_of_stock' ||
    product.availability === 'out_of_stock'
  )
    throw new ServiceError(422, 'Choose an available product from this organisation’s catalogue.');
  if (product.currency !== context.project.currency)
    throw new ServiceError(422, 'Product currency must match the project currency.');
  const object = operation.object;
  if (
    object.sku !== variant.sku ||
    object.category !== product.category ||
    object.name !== product.name ||
    object.color !== variant.color ||
    object.solid !== (product.category !== 'rug') ||
    object.dimensions.width !== Number(variant.width_m) ||
    object.dimensions.depth !== Number(variant.depth_m) ||
    object.dimensions.height !== Number(variant.height_m)
  )
    throw new ServiceError(
      409,
      'Catalogue details changed or do not match this product. Reload the catalogue and preview again.',
    );
  if (object.follows)
    throw new ServiceError(400, 'Add a catalogue item before configuring its relationships.');
}
export function projectDto(project: ProjectContext['project']) {
  return {
    id: project.id,
    organisationId: project.organisation_id,
    customerId: project.customer_id,
    name: project.name,
    budgetMinor: Number(project.budget_minor),
    currency: project.currency,
    style: project.style,
    roomType: project.room_type,
    status: project.status,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}
class SupabasePersistence implements Persistence {
  private admin = adminClient();
  private operation: unknown;
  constructor(
    private context: ProjectContext,
    private sceneId: string,
    private organisationId: string,
    request?: Request,
  ) {
    this.operation = request || { type: 'read' };
  }
  async load(): Promise<RecordData | null> {
    const result = await this.context.client
      .from('scenes')
      .select('data,history,future')
      .eq('id', this.sceneId)
      .eq('organisation_id', this.organisationId)
      .maybeSingle();
    databaseError(result.error);
    if (!result.data) throw new ServiceError(404, 'Project scene not found.');
    return {
      scene: sceneSchema.parse(result.data.data),
      history: (result.data.history as unknown[]).map((s) => sceneSchema.parse(s)),
      future: (result.data.future as unknown[]).map((s) => sceneSchema.parse(s)),
    };
  }
  async save(data: RecordData, expectedVersion?: number) {
    if (expectedVersion === undefined) throw new ServiceError(409, 'Scene version is required.');
    const result = await this.admin.rpc('commit_scene', {
      p_scene_id: this.sceneId,
      p_actor_id: this.context.user.id,
      p_expected_version: expectedVersion,
      p_scene: data.scene,
      p_history: data.history,
      p_future: data.future,
      p_operation: this.operation,
    });
    databaseError(result.error);
  }
  async saveProposal(saved: SavedProposal) {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const cleanup = await this.admin
      .from('scene_proposals')
      .delete()
      .eq('scene_id', this.sceneId)
      .eq('actor_id', this.context.user.id)
      .lt('created_at', cutoff);
    databaseError(cleanup.error);
    const count = await this.context.client
      .from('scene_proposals')
      .select('id', { head: true, count: 'exact' })
      .eq('scene_id', this.sceneId)
      .eq('actor_id', this.context.user.id);
    databaseError(count.error);
    if ((count.count || 0) >= 100)
      throw new ServiceError(
        429,
        'Too many pending previews. Accept a preview or wait for older previews to expire.',
      );
    const result = await this.admin
      .from('scene_proposals')
      .insert({
        id: saved.proposal.id,
        scene_id: this.sceneId,
        organisation_id: this.organisationId,
        actor_id: this.context.user.id,
        base_version: saved.proposal.baseVersion,
        payload: saved,
      });
    databaseError(result.error);
  }
  async loadProposal(id: string): Promise<SavedProposal | null> {
    const result = await this.context.client
      .from('scene_proposals')
      .select('payload,base_version')
      .eq('id', id)
      .eq('scene_id', this.sceneId)
      .eq('actor_id', this.context.user.id)
      .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .maybeSingle();
    databaseError(result.error);
    if (!result.data) return null;
    const payload = result.data.payload as SavedProposal;
    const request = requestSchema.parse(payload.operation);
    if (
      request.action !== 'preview' ||
      request.expectedVersion !== result.data.base_version ||
      payload.proposal.id !== id
    )
      throw new ServiceError(409, 'Invalid preview. Preview the change again.');
    await validateCatalogueOperation(this.context, request.operation);
    this.operation = { action: 'accept', ...request.operation };
    return {
      proposal: { ...payload.proposal, scene: sceneSchema.parse(payload.proposal.scene) },
      operation: request,
    };
  }
  async revisions(): Promise<{ version: number; scene: Scene }[]> {
    const result = await this.context.client
      .from('scene_versions')
      .select('version,data')
      .eq('scene_id', this.sceneId)
      .order('version', { ascending: false })
      .limit(100);
    databaseError(result.error);
    return (result.data || []).map((r) => ({ version: r.version, scene: sceneSchema.parse(r.data) }));
  }
}
export async function projectEditor(context: ProjectContext, request?: Request) {
  const result = await context.client
    .from('scenes')
    .select('id,data')
    .eq('project_id', context.project.id)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Project scene not found.');
  const initial = sceneSchema.parse(result.data.data);
  return new EditorService(
    new SupabasePersistence(context, result.data.id, context.project.organisation_id, request),
    initial,
  );
}
