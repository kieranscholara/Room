import 'server-only';
import { z } from 'zod';
import { adminClient, databaseError } from './supabase-server';
import { projectContext } from './project-service';
import { ServiceError } from './editor-service';
import { uuid } from './account-schemas';
import { quotationSnapshotSchema } from './quotation-schemas';
interface OrderRow {
  id: string;
  created_by: string;
  project_id: string;
  quotation_id: string;
  status: string;
  expires_at: string;
  snapshot: unknown;
  created_at: string;
  updated_at: string;
}
function orderDto(row: OrderRow) {
  return {
    id: row.id,
    quotationId: row.quotation_id,
    status: row.status,
    expiresAt: row.expires_at,
    snapshot: quotationSnapshotSchema.parse(row.snapshot),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function listProjectOrders(projectId: string) {
  const context = await projectContext(projectId),
    result = await context.client
      .from('retailer_orders')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(50);
  databaseError(result.error);
  const permitted = await adminClient().rpc('actor_can_order_project', {
    p_project_id: projectId,
    p_actor_id: context.user.id,
  });
  databaseError(permitted.error);
  return {
    canOrder: Boolean(permitted.data),
    canFulfil: ['owner', 'admin', 'salesperson'].includes(context.role),
    orders: (result.data ?? []).map((row) => ({
      ...orderDto(row as OrderRow),
      canManage:
        Boolean(permitted.data) && (row.created_by === context.user.id || context.role !== 'customer'),
    })),
  };
}
export async function reserveProjectOrder(projectId: string, input: unknown) {
  const request = z.object({ quotationId: z.uuid(), idempotencyKey: z.uuid() }).strict().parse(input),
    context = await projectContext(projectId),
    result = await adminClient().rpc('reserve_quotation_order', {
      p_project_id: projectId,
      p_actor_id: context.user.id,
      p_quotation_id: request.quotationId,
      p_idempotency_key: request.idempotencyKey,
    });
  databaseError(result.error);
  return orderDto(result.data as OrderRow);
}
export async function transitionProjectOrder(projectId: string, id: string, input: unknown) {
  uuid.parse(id);
  const request = z
      .object({
        expectedStatus: z.enum(['reserved', 'confirmed']),
        action: z.enum(['confirm', 'cancel', 'fulfil']),
      })
      .strict()
      .parse(input),
    context = await projectContext(projectId);
  const existing = await context.client
    .from('retailer_orders')
    .select('id')
    .eq('id', id)
    .eq('project_id', projectId)
    .maybeSingle();
  databaseError(existing.error);
  if (!existing.data) throw new ServiceError(404, 'Order not found.');
  const result = await adminClient().rpc('transition_retailer_order', {
    p_order_id: id,
    p_actor_id: context.user.id,
    p_expected_status: request.expectedStatus,
    p_action: request.action,
  });
  databaseError(result.error);
  return orderDto(result.data as OrderRow);
}
