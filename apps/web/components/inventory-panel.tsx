'use client';
import { FixtureInventory } from './fixture-inventory';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { validateMappings } from '@roomsell/inventory';
import { accountRequest, type WorkspaceContext } from './workspace-frame';
import type { CatalogueProduct } from './workspace-business-types';

interface InventoryConnection {
  id: string;
  name: string;
  provider: 'custom_rest';
  endpoint: string;
  orderEndpoint: string | null;
  enabled: boolean;
  revision: number;
  credentialConfigured: boolean;
  lastSyncedAt: string | null;
  lastSourceGeneratedAt: string | null;
}
interface InventoryMapping {
  connectionId: string;
  externalProductId: string;
  externalVariantId: string;
  productId: string;
  variantId: string;
}
interface InventoryRun {
  id: string;
  connectionId: string;
  status: 'completed' | 'failed';
  itemCount: number;
  errorCode: string | null;
  createdAt: string;
}
interface InventoryState {
  encryptionConfigured: boolean;
  connections: InventoryConnection[];
  mappings: InventoryMapping[];
  runs: InventoryRun[];
}
interface ConnectionForm {
  id: string | null;
  expectedRevision: number | null;
  name: string;
  endpoint: string;
  orderEndpoint: string;
  token: string;
  enabled: boolean;
}
interface MappingDraft {
  key: string;
  externalProductId: string;
  externalVariantId: string;
  productId: string;
  variantId: string;
}
interface MappingEdit {
  connectionId: string;
  expectedRevision: number;
  rows: MappingDraft[];
}
const PAGE_SIZE = 25;
const emptyConnection = (): ConnectionForm => ({
  id: null,
  expectedRevision: null,
  name: '',
  endpoint: '',
  orderEndpoint: '',
  token: '',
  enabled: true,
});
const emptyMapping = (): MappingDraft => ({
  key: crypto.randomUUID(),
  externalProductId: '',
  externalVariantId: '',
  productId: '',
  variantId: '',
});
function timestamp(value: string | null): string {
  if (!value) return 'Never';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Unavailable' : parsed.toLocaleString();
}

export function InventoryPanel({ context }: { context: WorkspaceContext }) {
  const { organisation, canManage } = context;
  const base = `/api/organisations/${organisation.id}/inventory`;
  const catalogueBase = `/api/organisations/${organisation.id}/catalogue`;
  const [state, setState] = useState<InventoryState | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<ConnectionForm | null>(null);
  const [mappingEdit, setMappingEdit] = useState<MappingEdit | null>(null);
  const [mappingPage, setMappingPage] = useState(0);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const next = await accountRequest<InventoryState>(base, { signal });
        setState(next);
        setMappingPage(0);
        setSelectedId((previous) =>
          next.connections.some((connection) => connection.id === previous)
            ? previous
            : next.connections[0]?.id || '',
        );
      } catch (reason) {
        if (!signal?.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not load inventory connections.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [base, canManage],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const connection = state?.connections.find((item) => item.id === selectedId);
  const mappings = state?.mappings.filter((item) => item.connectionId === selectedId) || [];
  const runs = state?.runs.filter((item) => item.connectionId === selectedId) || [];
  const unavailable = busy || loading || !state?.encryptionConfigured;
  if (!canManage)
    return (
      <p className="account-muted">
        Inventory connections are managed by your organisation’s owner or administrator.
      </p>
    );
  return (
    <>
      <FixtureInventory orgId={context.organisation.id} />
      <section className="account-panel" aria-label="Inventory connections">
        <div>
          <h1>Inventory integrations</h1>
          <p className="account-muted">
            Connect a retailer inventory endpoint, map its product references to your real catalogue, then
            synchronise prices, stock and availability when needed.
          </p>
        </div>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="account-notice">
            {message}
          </p>
        )}
        {state && !state.encryptionConfigured && (
          <p role="status" className="account-notice">
            Inventory credentials need server encryption configuration before connections can be saved or
            synchronised. Your deployment administrator must configure the inventory encryption key.
          </p>
        )}
        <div className="business-actions">
          <Button
            disabled={unavailable}
            onClick={() => {
              setForm(emptyConnection());
              setMappingEdit(null);
              setError('');
            }}
          >
            New inventory connection
          </Button>
          <Button
            disabled={busy || loading}
            onClick={() => {
              setError('');
              void load();
            }}
          >
            Refresh inventory
          </Button>
        </div>
        {loading && <p role="status">Loading inventory connections…</p>}
        <details className="account-details">
          <summary>Supported inventory endpoint</summary>
          <div className="business-form">
            <p className="account-muted">
              This connector reads a custom REST inventory snapshot from a public HTTPS endpoint using its
              bearer access token. The endpoint must return JSON with schemaVersion equal to 1, generatedAt as
              an ISO date and time, and an items array. Each item needs externalProductId, externalVariantId,
              sku, currency, priceMinor, stockQuantity and availability. Prices use integer currency minor
              units.
            </p>
            <p className="account-muted">
              The snapshot must contain exactly the configured mappings, up to 1,000 items and 1 MiB. It must
              be newer than the last accepted snapshot and no more than 15 minutes old. Availability accepts
              in_stock, made_to_order or out_of_stock; in-stock items require positive stock and out-of-stock
              items require zero stock. Unknown references or mismatched SKUs reject the whole update.
            </p>
          </div>
        </details>
        {form && (
          <form
            aria-label="Inventory connection form"
            className="business-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (unavailable) return;
              const submitted = { ...form };
              setForm((current) => (current ? { ...current, token: '' } : null));
              setBusy(true);
              setError('');
              setMessage('');
              try {
                await accountRequest(`${base}${submitted.id ? `/${submitted.id}` : ''}`, {
                  method: submitted.id ? 'PATCH' : 'POST',
                  body: {
                    ...(submitted.id ? { expectedRevision: submitted.expectedRevision } : {}),
                    name: submitted.name,
                    endpoint: submitted.endpoint,
                    orderEndpoint: submitted.orderEndpoint.trim() || null,
                    enabled: submitted.enabled,
                    ...(!submitted.id || submitted.token ? { token: submitted.token } : {}),
                  },
                });
                setForm(null);
                setMessage('Inventory connection saved. Review its mappings before synchronising.');
                await load();
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Could not save this connection.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>{form.id ? 'Edit inventory connection' : 'New inventory connection'}</h2>
            <div className="business-form-grid">
              <Field label="Connection name">
                <input
                  aria-label="Connection name"
                  required
                  maxLength={100}
                  disabled={unavailable}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <Field label="Inventory endpoint">
                <input
                  aria-label="Inventory endpoint"
                  type="url"
                  required
                  pattern="https://.*"
                  maxLength={2048}
                  disabled={unavailable}
                  value={form.endpoint}
                  onChange={(event) => setForm({ ...form, endpoint: event.target.value })}
                />
              </Field>
              <Field label="Supplier acknowledgement endpoint (optional)">
                <input
                  aria-label="Supplier acknowledgement endpoint (optional)"
                  type="url"
                  pattern="https://.*"
                  maxLength={2048}
                  disabled={unavailable}
                  value={form.orderEndpoint}
                  onChange={(event) => setForm({ ...form, orderEndpoint: event.target.value })}
                />
              </Field>
              <Field label={form.id ? 'Replacement access token (optional)' : 'Inventory access token'}>
                <input
                  aria-label={form.id ? 'Replacement access token (optional)' : 'Inventory access token'}
                  type="password"
                  autoComplete="new-password"
                  required={!form.id}
                  maxLength={4096}
                  disabled={unavailable}
                  value={form.token}
                  onChange={(event) => setForm({ ...form, token: event.target.value })}
                />
              </Field>
              <label className="business-checkbox">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={unavailable}
                  onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                />
                Connection enabled
              </label>
            </div>
            <p className="account-muted">
              Use a public HTTPS endpoint that returns the supported inventory snapshot. Access tokens are
              encrypted on the server and cleared from this form when submitted.
              {form.id && ' Leave the replacement token blank to retain the existing credential.'}
            </p>
            <div className="business-actions">
              <Button type="submit" variant="primary" disabled={unavailable}>
                {busy ? 'Saving…' : 'Save inventory connection'}
              </Button>
              <Button type="button" disabled={busy} onClick={() => setForm(null)}>
                Cancel connection edit
              </Button>
            </div>
          </form>
        )}
        {!loading && state && !state.connections.length && (
          <p className="account-empty">
            No inventory connections yet. Add a supported retailer endpoint to begin. Catalogue CSV imports
            remain available in Catalogue.
          </p>
        )}
        {!!state?.connections.length && (
          <Field label="Inventory connection">
            <select
              aria-label="Inventory connection"
              value={selectedId}
              disabled={busy}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setForm(null);
                setMappingEdit(null);
                setMappingPage(0);
                setConfirmReplace(false);
                setError('');
                setMessage('');
              }}
            >
              {state.connections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {!item.enabled && ' · Disabled'}
                </option>
              ))}
            </select>
          </Field>
        )}
        {connection && (
          <>
            <section className="business-form" aria-label="Selected inventory connection">
              <h2>{connection.name}</h2>
              <p className="account-muted">
                Custom REST inventory snapshot · {connection.enabled ? 'Enabled' : 'Disabled'}
                {' · '}
                {connection.credentialConfigured ? 'Credential configured' : 'Credential missing'} · Revision{' '}
                {connection.revision}
              </p>
              <p className="account-muted" style={{ overflowWrap: 'anywhere' }}>
                {connection.endpoint}
              </p>
              <p className="account-muted">
                {connection.orderEndpoint
                  ? 'Supplier acknowledgement configured: ' + connection.orderEndpoint
                  : 'Snapshot only: supplier fulfilment is disabled until an acknowledgement endpoint is configured.'}
              </p>
              <p>Last completed synchronisation: {timestamp(connection.lastSyncedAt)}</p>
              <p className="account-muted">
                Last source snapshot: {timestamp(connection.lastSourceGeneratedAt)}
              </p>
              <div className="business-actions">
                <Button
                  disabled={unavailable}
                  onClick={() => {
                    setForm({
                      id: connection.id,
                      expectedRevision: connection.revision,
                      name: connection.name,
                      endpoint: connection.endpoint,
                      orderEndpoint: connection.orderEndpoint ?? '',
                      enabled: connection.enabled,
                      token: '',
                    });
                    setMappingEdit(null);
                    setError('');
                  }}
                >
                  Edit connection
                </Button>
                <Button
                  disabled={
                    unavailable ||
                    !connection.enabled ||
                    !connection.credentialConfigured ||
                    !mappings.length ||
                    !!mappingEdit ||
                    !!form
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    setMessage('');
                    try {
                      const result = await accountRequest<{
                        connection: InventoryConnection;
                        run: InventoryRun;
                      }>(`${base}/${connection.id}/sync`, {
                        method: 'POST',
                        body: { expectedRevision: connection.revision },
                      });
                      setMessage(
                        `Synchronisation completed: ${result.run.itemCount} mapped inventory items updated.`,
                      );
                    } catch (reason) {
                      setError(
                        reason instanceof Error ? reason.message : 'Inventory synchronisation failed.',
                      );
                    } finally {
                      await load();
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? 'Working…' : 'Synchronise inventory now'}
                </Button>
              </div>
              <p className="account-muted">
                Synchronisation updates mapped prices, stock and availability after full validation. It does
                not reserve inventory. Unmapped or conflicting snapshots are rejected.
              </p>
            </section>
            <section className="business-form" aria-label="Inventory product mappings">
              <h2>Product mappings</h2>
              <p className="account-muted">
                {mappings.length} saved mappings. Match the provider’s exact product and variant references to
                existing catalogue variants; provider SKUs must match your catalogue.
              </p>
              {!mappingEdit ? (
                <>
                  <Button
                    disabled={unavailable}
                    onClick={() => {
                      setMappingEdit({
                        connectionId: connection.id,
                        expectedRevision: connection.revision,
                        rows: mappings.map((mapping) => ({
                          key: crypto.randomUUID(),
                          externalProductId: mapping.externalProductId,
                          externalVariantId: mapping.externalVariantId,
                          productId: mapping.productId,
                          variantId: mapping.variantId,
                        })),
                      });
                      setForm(null);
                      setMappingPage(0);
                      setConfirmReplace(false);
                    }}
                  >
                    Edit inventory mappings
                  </Button>
                  {mappings.slice(mappingPage * PAGE_SIZE, (mappingPage + 1) * PAGE_SIZE).map((mapping) => (
                    <div
                      className="business-import-result"
                      key={`${mapping.externalProductId}:${mapping.externalVariantId}`}
                    >
                      <strong>
                        {mapping.externalProductId} / {mapping.externalVariantId}
                      </strong>
                      <p className="account-muted" style={{ overflowWrap: 'anywhere' }}>
                        Catalogue product {mapping.productId} · Variant {mapping.variantId}
                      </p>
                    </div>
                  ))}
                  {mappings.length > PAGE_SIZE && (
                    <MappingPages
                      page={mappingPage}
                      count={mappings.length}
                      disabled={busy}
                      onChange={setMappingPage}
                    />
                  )}
                </>
              ) : (
                <MappingEditor
                  catalogueBase={catalogueBase}
                  edit={mappingEdit}
                  page={mappingPage}
                  disabled={unavailable}
                  confirmReplace={confirmReplace}
                  onConfirmReplace={setConfirmReplace}
                  onPage={setMappingPage}
                  onChange={(next) => {
                    setMappingEdit(next);
                    setConfirmReplace(false);
                  }}
                  onCancel={() => {
                    setMappingEdit(null);
                    setMappingPage(0);
                    setConfirmReplace(false);
                  }}
                  onSave={async () => {
                    setBusy(true);
                    setError('');
                    setMessage('');
                    try {
                      await accountRequest(`${base}/${mappingEdit.connectionId}/mappings`, {
                        method: 'PUT',
                        body: {
                          expectedRevision: mappingEdit.expectedRevision,
                          mappings: mappingEdit.rows.map(
                            ({ externalProductId, externalVariantId, productId, variantId }) => ({
                              externalProductId,
                              externalVariantId,
                              productId,
                              variantId,
                            }),
                          ),
                        },
                      });
                      setMappingEdit(null);
                      setMappingPage(0);
                      setConfirmReplace(false);
                      setMessage(
                        'Inventory mappings replaced. You can now synchronise a matching source snapshot.',
                      );
                      await load();
                    } catch (reason) {
                      setError(
                        reason instanceof Error ? reason.message : 'Could not save inventory mappings.',
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
            </section>
            <section className="business-form" aria-label="Inventory synchronisation history">
              <h2>Synchronisation history</h2>
              {!runs.length && <p className="account-muted">No synchronisation runs recorded.</p>}
              {runs.map((run) => (
                <div className="business-import-result" key={run.id}>
                  <strong>
                    {run.status === 'completed' ? 'Completed' : 'Failed'} · {timestamp(run.createdAt)}
                  </strong>
                  <p>
                    {run.itemCount} items{run.errorCode ? ` · ${run.errorCode.replaceAll('_', ' ')}` : ''}
                  </p>
                </div>
              ))}
            </section>
          </>
        )}
      </section>
    </>
  );
}

function MappingPages({
  page,
  count,
  disabled,
  onChange,
}: {
  page: number;
  count: number;
  disabled: boolean;
  onChange(page: number): void;
}) {
  return (
    <div className="business-actions" aria-label="Mapping pages">
      <Button type="button" disabled={disabled || page === 0} onClick={() => onChange(page - 1)}>
        Previous mapping page
      </Button>
      <span className="account-muted">
        Mapping page {page + 1} of {Math.max(1, Math.ceil(count / PAGE_SIZE))}
      </span>
      <Button
        type="button"
        disabled={disabled || (page + 1) * PAGE_SIZE >= count}
        onClick={() => onChange(page + 1)}
      >
        Next mapping page
      </Button>
    </div>
  );
}

function MappingEditor({
  catalogueBase,
  edit,
  page,
  disabled,
  confirmReplace,
  onConfirmReplace,
  onPage,
  onChange,
  onCancel,
  onSave,
}: {
  catalogueBase: string;
  edit: MappingEdit;
  page: number;
  disabled: boolean;
  confirmReplace: boolean;
  onConfirmReplace(value: boolean): void;
  onPage(value: number): void;
  onChange(value: MappingEdit): void;
  onCancel(): void;
  onSave(): Promise<void>;
}) {
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ offset: String(offset), ...(search ? { q: search } : {}) });
    void accountRequest<CatalogueProduct[]>(`${catalogueBase}?${params}`, { signal: controller.signal })
      .then(setProducts)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not load catalogue targets.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [catalogueBase, search, offset]);
  return (
    <form
      className="business-form"
      aria-label="Inventory mapping form"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !confirmReplace) return;
        const incomplete = edit.rows.findIndex(
          (row) =>
            !row.externalProductId.trim() ||
            !row.externalVariantId.trim() ||
            !row.productId ||
            !row.variantId,
        );
        if (incomplete !== -1) {
          setError(`Complete all references in mapping ${incomplete + 1} before replacing the mappings.`);
          onPage(Math.floor(incomplete / PAGE_SIZE));
          return;
        }
        try {
          validateMappings(
            edit.rows.map(({ externalProductId, externalVariantId, productId, variantId }) => ({
              externalProductId,
              externalVariantId,
              productId,
              variantId,
            })),
          );
          setError('');
          void onSave();
        } catch {
          setError(
            'Use valid catalogue references, one unique external product/variant pair and one mapping per catalogue variant.',
          );
        }
      }}
    >
      <p className="account-notice">
        Saving replaces every mapping for this connection. Removing a row removes its association; an empty
        list removes all associations. Existing catalogue products and scenes are retained.
      </p>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <Field label="Search mapping catalogue">
        <input
          aria-label="Search mapping catalogue"
          type="search"
          maxLength={100}
          disabled={disabled}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      <div className="business-actions">
        <Button
          type="button"
          disabled={disabled || loading}
          onClick={() => {
            setSearch(query.trim());
            setOffset(0);
          }}
        >
          Search mapping catalogue
        </Button>
        <Button
          type="button"
          disabled={disabled || loading || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous target catalogue page
        </Button>
        <Button
          type="button"
          disabled={disabled || loading || products.length < 100 || offset >= 100000}
          onClick={() => setOffset(offset + 100)}
        >
          Next target catalogue page
        </Button>
      </div>
      <p className="account-muted">
        Catalogue target page {Math.floor(offset / 100) + 1} · up to 100 real products per page.
      </p>
      {loading && <p role="status">Loading catalogue targets…</p>}
      {!loading && !products.length && (
        <p className="account-muted">
          No catalogue products match. Create real products in Catalogue or change the search.
        </p>
      )}
      {edit.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row, index) => (
        <MappingRow
          key={row.key}
          row={row}
          rowNumber={page * PAGE_SIZE + index + 1}
          products={products}
          catalogueBase={catalogueBase}
          disabled={disabled || loading}
          onChange={(next) =>
            onChange({ ...edit, rows: edit.rows.map((value) => (value.key === row.key ? next : value)) })
          }
          onRemove={() => {
            const nextRows = edit.rows.filter((value) => value.key !== row.key);
            onChange({ ...edit, rows: nextRows });
            onPage(Math.min(page, Math.max(0, Math.ceil(nextRows.length / PAGE_SIZE) - 1)));
          }}
        />
      ))}
      {!!edit.rows.length && (
        <MappingPages page={page} count={edit.rows.length} disabled={disabled} onChange={onPage} />
      )}
      <div className="business-actions">
        <Button
          type="button"
          disabled={disabled || edit.rows.length >= 1000}
          onClick={() => {
            onChange({ ...edit, rows: [...edit.rows, emptyMapping()] });
            onPage(Math.floor(edit.rows.length / PAGE_SIZE));
          }}
        >
          Add inventory mapping
        </Button>
      </div>
      <label className="business-checkbox">
        <input
          type="checkbox"
          checked={confirmReplace}
          disabled={disabled}
          onChange={(event) => onConfirmReplace(event.target.checked)}
        />
        I confirm replacement of all saved mappings for this connection.
      </label>
      <div className="business-actions">
        <Button type="submit" variant="primary" disabled={disabled || loading || !confirmReplace}>
          Replace inventory mappings
        </Button>
        <Button type="button" disabled={disabled} onClick={onCancel}>
          Cancel mapping edit
        </Button>
      </div>
    </form>
  );
}

function MappingRow({
  row,
  rowNumber,
  products,
  catalogueBase,
  disabled,
  onChange,
  onRemove,
}: {
  row: MappingDraft;
  rowNumber: number;
  products: CatalogueProduct[];
  catalogueBase: string;
  disabled: boolean;
  onChange(row: MappingDraft): void;
  onRemove(): void;
}) {
  const visibleProduct = products.find((product) => product.id === row.productId);
  const [storedProduct, setStoredProduct] = useState<CatalogueProduct | null>(null);
  const [error, setError] = useState('');
  const missingId = row.productId && !visibleProduct ? row.productId : '';
  useEffect(() => {
    setStoredProduct(null);
    setError('');
    if (!missingId) return;
    const controller = new AbortController();
    void accountRequest<CatalogueProduct>(`${catalogueBase}/${missingId}`, { signal: controller.signal })
      .then(setStoredProduct)
      .catch(() => {
        if (!controller.signal.aborted)
          setError('The mapped product cannot be loaded. Choose an existing catalogue product.');
      });
    return () => controller.abort();
  }, [catalogueBase, missingId]);
  const product = visibleProduct || (storedProduct?.id === row.productId ? storedProduct : null);
  const choices =
    product && !products.some((value) => value.id === product.id) ? [product, ...products] : products;
  return (
    <fieldset className="business-variant">
      <legend>Mapping {rowNumber}</legend>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <div className="business-form-grid">
        <Field label={`Mapping ${rowNumber} external product ID`}>
          <input
            aria-label={`Mapping ${rowNumber} external product ID`}
            required
            maxLength={200}
            disabled={disabled}
            value={row.externalProductId}
            onChange={(event) => onChange({ ...row, externalProductId: event.target.value })}
          />
        </Field>
        <Field label={`Mapping ${rowNumber} external variant ID`}>
          <input
            aria-label={`Mapping ${rowNumber} external variant ID`}
            required
            maxLength={200}
            disabled={disabled}
            value={row.externalVariantId}
            onChange={(event) => onChange({ ...row, externalVariantId: event.target.value })}
          />
        </Field>
        <Field label={`Mapping ${rowNumber} catalogue product`}>
          <select
            aria-label={`Mapping ${rowNumber} catalogue product`}
            required
            disabled={disabled}
            value={row.productId}
            onChange={(event) => onChange({ ...row, productId: event.target.value, variantId: '' })}
          >
            <option value="">Choose an existing product</option>
            {row.productId && !product && (
              <option value={row.productId}>Saved product · {row.productId}</option>
            )}
            {choices.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name} · {value.sku}
                {!value.active && ' · Archived'}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Mapping ${rowNumber} catalogue variant`}>
          <select
            aria-label={`Mapping ${rowNumber} catalogue variant`}
            required
            disabled={disabled || !product}
            value={row.variantId}
            onChange={(event) => onChange({ ...row, variantId: event.target.value })}
          >
            <option value="">Choose an existing variant</option>
            {row.variantId && !product?.variants.some((variant) => variant.id === row.variantId) && (
              <option value={row.variantId}>Saved variant · {row.variantId}</option>
            )}
            {product?.variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name} · {variant.sku}
                {!variant.active && ' · Inactive'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button type="button" variant="danger" disabled={disabled} onClick={onRemove}>
        Remove mapping {rowNumber}
      </Button>
    </fieldset>
  );
}
