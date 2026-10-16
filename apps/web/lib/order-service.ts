import 'server-only';
import { z } from 'zod';
import { adminClient, databaseError } from './supabase-server';
import { projectContext } from './project-service';
import { ServiceError } from './editor-service';
import { uuid } from './account-schemas';
import { quotationSnapshotSchema } from './quotation-schemas';
import { decryptInventoryToken, secureProviderRequest } from '@roomsell/inventory/server';
import { requestSupplierFulfilment } from '@roomsell/inventory/fulfilment';
import { fixtureFulfilmentTransport } from './local-testing';
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
  const acknowledgements = await context.client
    .from('supplier_fulfilments')
    .select('order_id,receipt')
    .in(
      'order_id',
      (result.data ?? []).map((row) => row.id),
    );
  databaseError(acknowledgements.error);
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
      supplierAcknowledgement:
        acknowledgements.data?.find((item) => item.order_id === row.id)?.receipt ?? null,
      supplierPending:
        acknowledgements.data?.some((item) => item.order_id === row.id && !item.receipt) ?? false,
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
  if (request.action === 'fulfil') {
    if (request.expectedStatus !== 'confirmed') throw new ServiceError(409, 'Confirmed order required.');
    const admin = adminClient();
    const prepared = await admin.rpc('begin_supplier_fulfilment', {
      p_order_id: id,
      p_actor_id: context.user.id,
    });
    databaseError(prepared.error);
    if (prepared.data) {
      const command = prepared.data;
      if (command.receipt) {
        if (command.receipt.status === 'rejected')
          throw new ServiceError(
            422,
            'The supplier declined this order. Cancel it, synchronize inventory, then issue a new quotation.',
          );
        const saved = await context.client.from('retailer_orders').select('*').eq('id', id).single();
        databaseError(saved.error);
        return orderDto(saved.data as OrderRow);
      }
      let receipt;
      try {
        const credential = await admin
          .from('inventory_credentials')
          .select('token_envelope')
          .eq('connection_id', command.connection_id)
          .eq('organisation_id', command.organisation_id)
          .single();
        databaseError(credential.error);
        if (!credential.data) throw new Error('Supplier credential is unavailable.');
        const token = decryptInventoryToken(
          credential.data.token_envelope,
          process.env.ROOMSELL_CONNECTOR_ENCRYPTION_KEY,
          command.organisation_id,
        );
        const transport = await fixtureFulfilmentTransport(
          command.organisation_id,
          command.connection_id,
          command.endpoint,
        );
        receipt = await requestSupplierFulfilment(
          command.endpoint,
          token,
          command.request,
          transport ?? secureProviderRequest,
        );
      } catch {
        throw new ServiceError(
          503,
          'Supplier acknowledgement is pending. Retry Record fulfilment; the same supplier order reference is reused. Inventory and cancellation remain held until the supplier outcome is known.',
        );
      }
      const completed = await admin.rpc('finish_supplier_fulfilment', {
        p_order_id: id,
        p_actor_id: context.user.id,
        p_receipt: receipt,
      });
      databaseError(completed.error);
      if (receipt.status === 'rejected')
        throw new ServiceError(
          422,
          'The supplier declined this order. Cancel it, synchronize inventory, then issue a new quotation.',
        );
      return orderDto(completed.data as OrderRow);
    }
  }
  const result = await adminClient().rpc('transition_retailer_order', {
    p_order_id: id,
    p_actor_id: context.user.id,
    p_expected_status: request.expectedStatus,
    p_action: request.action,
  });
  databaseError(result.error);
  return orderDto(result.data as OrderRow);
}
