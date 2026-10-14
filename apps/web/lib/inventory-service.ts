import 'server-only';
import { z } from 'zod';
import {
  InventoryError,
  inventoryEndpoint,
  mapSnapshot,
  validateMappings,
  type InventoryConnection,
  type InventoryMapping,
} from '@roomsell/inventory';
import {
  decryptInventoryToken,
  encryptInventoryToken,
  encryptionConfigured,
  fetchInventorySnapshot,
  resolveInventoryEndpoint,
} from '@roomsell/inventory/server';
import { adminClient, databaseError, membership } from './supabase-server';
import { ServiceError } from './editor-service';

const managers = ['owner', 'admin'] as const;
const tokenSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (token) => !Array.from(token).some((character) => [0, 10, 13].includes(character.charCodeAt(0))),
    'The token cannot contain line breaks or null bytes.',
  );
const configFields = {
  name: z.string().trim().min(1).max(100),
  endpoint: z.string().min(1).max(2048),
  enabled: z.boolean(),
};
const createSchema = z.object({ ...configFields, token: tokenSchema }).strict();
const updateSchema = z
  .object({
    ...configFields,
    token: tokenSchema.optional(),
    expectedRevision: z.number().int().positive().max(2_147_483_646),
  })
  .strict();
const revisionSchema = z.object({ expectedRevision: updateSchema.shape.expectedRevision }).strict();
interface ConnectionRow {
  id: string;
  organisation_id: string;
  name: string;
  provider: 'custom_rest';
  endpoint: string;
  enabled: boolean;
  revision: number;
  last_synced_at: string | null;
  last_source_generated_at: string | null;
}
interface RunRow {
  id: string;
  connection_id: string;
  status: 'completed' | 'failed';
  item_count: number;
  error_code: string | null;
  created_at: string;
}
function connectionDto(row: ConnectionRow, credentialConfigured: boolean): InventoryConnection {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    endpoint: row.endpoint,
    enabled: row.enabled,
    revision: row.revision,
    credentialConfigured,
    lastSyncedAt: row.last_synced_at,
    lastSourceGeneratedAt: row.last_source_generated_at,
  };
}
function runDto(row: RunRow) {
  return {
    id: row.id,
    connectionId: row.connection_id,
    status: row.status,
    itemCount: row.item_count,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}
function requiredEncryptionKey() {
  const key = process.env.ROOMSELL_CONNECTOR_ENCRYPTION_KEY;
  if (!encryptionConfigured(key))
    throw new ServiceError(503, 'Inventory credential encryption is not configured.');
  return key;
}
function inventoryServiceError(error: InventoryError) {
  return new ServiceError(error.code === 'credentials_unavailable' ? 503 : 422, error.message, {
    code: error.code,
  });
}
export async function inventoryOverview(orgId: string) {
  const { client } = await membership(orgId, managers);
  const [connections, mappings, runs] = await Promise.all([
    client.from('inventory_connections').select('*').eq('organisation_id', orgId).order('created_at'),
    client.from('inventory_mappings').select('*').eq('organisation_id', orgId).order('external_product_id'),
    client
      .from('inventory_sync_runs')
      .select('id,connection_id,status,item_count,error_code,created_at')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  databaseError(connections.error);
  databaseError(mappings.error);
  databaseError(runs.error);
  // Only credential existence is selected after manager authorization; ciphertext
  // never enters a client-visible query, object or API response.
  const credentials = await adminClient()
    .from('inventory_credentials')
    .select('connection_id')
    .eq('organisation_id', orgId);
  databaseError(credentials.error);
  const configured = new Set(credentials.data?.map((row) => row.connection_id));
  return {
    encryptionConfigured: encryptionConfigured(process.env.ROOMSELL_CONNECTOR_ENCRYPTION_KEY),
    connections: ((connections.data ?? []) as ConnectionRow[]).map((row) =>
      connectionDto(row, configured.has(row.id)),
    ),
    mappings: (mappings.data ?? []).map((row) => ({
      connectionId: row.connection_id,
      externalProductId: row.external_product_id,
      externalVariantId: row.external_variant_id,
      productId: row.product_id,
      variantId: row.variant_id,
    })),
    runs: ((runs.data ?? []) as RunRow[]).map(runDto),
  };
}
async function currentConnection(
  client: Awaited<ReturnType<typeof membership>>['client'],
  orgId: string,
  connectionId: string,
) {
  const result = await client
    .from('inventory_connections')
    .select('*')
    .eq('organisation_id', orgId)
    .eq('id', connectionId)
    .maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new ServiceError(404, 'Inventory connection not found.');
  return result.data as ConnectionRow;
}
export async function writeInventoryConnection(orgId: string, connectionId: string | null, input: unknown) {
  const { client, user } = await membership(orgId, managers);
  const key = requiredEncryptionKey();
  const config = connectionId ? updateSchema.parse(input) : createSchema.parse(input);
  try {
    const endpoint = inventoryEndpoint(config.endpoint).toString();
    await resolveInventoryEndpoint(endpoint);
    if (connectionId) {
      const current = await currentConnection(client, orgId, connectionId);
      if (inventoryEndpoint(current.endpoint).origin !== inventoryEndpoint(endpoint).origin && !config.token)
        throw new ServiceError(400, 'Re-enter a provider token when changing the endpoint host.');
    }
    const saved = await adminClient().rpc('inventory_connection_write', {
      p_org_id: orgId,
      p_actor_id: user.id,
      p_connection_id: connectionId,
      p_expected_revision: 'expectedRevision' in config ? config.expectedRevision : null,
      p_config: { name: config.name, endpoint, enabled: config.enabled },
      p_token_envelope: config.token ? encryptInventoryToken(config.token, key, orgId) : null,
    });
    databaseError(saved.error);
    return connectionDto(saved.data as ConnectionRow, true);
  } catch (error) {
    if (error instanceof InventoryError) throw inventoryServiceError(error);
    throw error;
  }
}
export async function replaceInventoryMappings(orgId: string, connectionId: string, input: unknown) {
  const { user } = await membership(orgId, managers);
  requiredEncryptionKey();
  const parsed = z
    .object({ expectedRevision: updateSchema.shape.expectedRevision, mappings: z.unknown() })
    .strict()
    .parse(input);
  let mappings: InventoryMapping[];
  try {
    mappings = validateMappings(parsed.mappings);
  } catch (error) {
    if (error instanceof InventoryError) throw inventoryServiceError(error);
    throw error;
  }
  const saved = await adminClient().rpc('inventory_replace_mappings', {
    p_org_id: orgId,
    p_actor_id: user.id,
    p_connection_id: connectionId,
    p_expected_revision: parsed.expectedRevision,
    p_mappings: mappings,
  });
  databaseError(saved.error);
  return connectionDto(saved.data as ConnectionRow, true);
}
export async function syncInventoryConnection(orgId: string, connectionId: string, input: unknown) {
  const { user, client } = await membership(orgId, managers);
  const key = requiredEncryptionKey();
  const { expectedRevision } = revisionSchema.parse(input);
  const connection = await currentConnection(client, orgId, connectionId);
  if (connection.revision !== expectedRevision || !connection.enabled)
    throw new ServiceError(409, 'Inventory configuration changed or is disabled; reload and retry.');
  const admin = adminClient();
  try {
    const [credentials, mappings] = await Promise.all([
      admin
        .from('inventory_credentials')
        .select('token_envelope')
        .eq('organisation_id', orgId)
        .eq('connection_id', connectionId)
        .maybeSingle(),
      client
        .from('inventory_mappings')
        .select('*')
        .eq('organisation_id', orgId)
        .eq('connection_id', connectionId),
    ]);
    databaseError(credentials.error);
    databaseError(mappings.error);
    if (!credentials.data?.token_envelope) throw new InventoryError('credentials_unavailable');
    const token = decryptInventoryToken(credentials.data.token_envelope, key, orgId);
    const snapshot = await fetchInventorySnapshot(connection.endpoint, token, {
      lastGeneratedAt: connection.last_source_generated_at,
    });
    const mapped = mapSnapshot(
      snapshot,
      (mappings.data ?? []).map((row) => ({
        externalProductId: row.external_product_id,
        externalVariantId: row.external_variant_id,
        productId: row.product_id,
        variantId: row.variant_id,
      })),
    );
    const saved = await admin.rpc('inventory_apply_snapshot', {
      p_org_id: orgId,
      p_actor_id: user.id,
      p_connection_id: connectionId,
      p_expected_revision: expectedRevision,
      p_generated_at: snapshot.generatedAt,
      p_items: mapped,
    });
    databaseError(saved.error);
    const result = saved.data as { connection: ConnectionRow; run: RunRow };
    if (result.run.status === 'failed')
      throw new ServiceError(
        422,
        'Inventory changed or the provider snapshot could not be applied. No catalogue data was changed.',
        { code: result.run.error_code },
      );
    return { connection: connectionDto(result.connection, true), run: runDto(result.run) };
  } catch (error) {
    if (error instanceof InventoryError) {
      const recorded = await admin.rpc('inventory_record_failure', {
        p_org_id: orgId,
        p_actor_id: user.id,
        p_connection_id: connectionId,
        p_error_code: error.code,
      });
      databaseError(recorded.error);
      throw inventoryServiceError(error);
    }
    throw error;
  }
}
