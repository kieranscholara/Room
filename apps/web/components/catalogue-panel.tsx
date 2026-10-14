'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { CSV_HEADERS } from '@roomsell/catalogue';
import { accountRequest, type WorkspaceContext } from './workspace-frame';
import {
  formatMoney,
  moneyInput,
  parseMoney,
  type CatalogueProduct,
  type Category,
  type ProductVariant,
  type Availability,
} from './workspace-business-types';

interface InventoryForm {
  id?: string;
  sku: string;
  name: string;
  price: string;
  width: string;
  depth: string;
  height: string;
  color: string;
  material: string;
  active: boolean;
  availability: string;
  stock: string;
  lead: string;
}
interface ProductForm extends InventoryForm {
  category: Category;
  currency: string;
  variants: InventoryForm[];
}
interface ImportResult {
  id: string;
  status: string;
  fileName?: string;
  summary: {
    rowCount: number;
    productCount: number;
    variantCount: number;
    errors: { row: number; field?: string; column?: string; message: string }[];
  };
}
const emptyInventory = (): InventoryForm => ({
  sku: '',
  name: '',
  price: '',
  width: '',
  depth: '',
  height: '',
  color: '#808080',
  material: '',
  active: true,
  availability: '',
  stock: '',
  lead: '',
});
const emptyProduct = (currency: string): ProductForm => ({
  ...emptyInventory(),
  category: 'bed',
  currency,
  variants: [],
});
function inventoryForm(item: ProductVariant, currency: string): InventoryForm {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    price: moneyInput(item.priceMinor, currency),
    width: String(item.dimensions.width),
    depth: String(item.dimensions.depth),
    height: String(item.dimensions.height),
    color: item.color,
    material: item.material,
    active: item.active,
    availability: item.availability,
    stock: String(item.stockQuantity),
    lead: String(item.leadTimeDays),
  };
}
function inventoryInput(form: InventoryForm, currency: string) {
  return {
    ...(form.id ? { id: form.id } : {}),
    sku: form.sku,
    name: form.name,
    priceMinor: parseMoney(form.price, currency),
    dimensions: { width: Number(form.width), depth: Number(form.depth), height: Number(form.height) },
    color: form.color,
    material: form.material,
    active: form.active,
    availability: form.availability as Availability,
    stockQuantity: Number(form.stock),
    leadTimeDays: Number(form.lead),
  };
}
function InventoryFields({
  form,
  onChange,
  label,
  disabled,
}: {
  form: InventoryForm;
  onChange(value: InventoryForm): void;
  label: string;
  disabled: boolean;
}) {
  return (
    <div className="business-form-grid">
      <Field label={`${label} SKU`}>
        <input
          aria-label={`${label} SKU`}
          value={form.sku}
          required
          maxLength={100}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, sku: event.target.value })}
        />
      </Field>
      <Field label={`${label} name`}>
        <input
          aria-label={`${label} name`}
          value={form.name}
          required
          maxLength={100}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </Field>
      <Field label={`${label} price`}>
        <input
          aria-label={`${label} price`}
          value={form.price}
          required
          inputMode="decimal"
          pattern="[0-9]+(\.[0-9]+)?"
          disabled={disabled}
          onChange={(event) => onChange({ ...form, price: event.target.value })}
        />
      </Field>
      {(['width', 'depth', 'height'] as const).map((dimension) => (
        <Field key={dimension} label={`${label} ${dimension} (m)`}>
          <input
            aria-label={`${label} ${dimension} (m)`}
            type="number"
            required
            min="0.001"
            step="0.001"
            max={dimension === 'height' ? 10 : 20}
            value={form[dimension]}
            disabled={disabled}
            onChange={(event) => onChange({ ...form, [dimension]: event.target.value })}
          />
        </Field>
      ))}
      <Field label={`${label} colour`}>
        <input
          aria-label={`${label} colour`}
          type="color"
          value={form.color}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, color: event.target.value })}
        />
      </Field>
      <Field label={`${label} material`}>
        <input
          aria-label={`${label} material`}
          maxLength={100}
          value={form.material}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, material: event.target.value })}
        />
      </Field>
      <Field label={`${label} availability`}>
        <select
          aria-label={`${label} availability`}
          required
          value={form.availability}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, availability: event.target.value })}
        >
          <option value="">Choose availability</option>
          <option value="in_stock">In stock</option>
          <option value="made_to_order">Made to order</option>
          <option value="out_of_stock">Out of stock</option>
        </select>
      </Field>
      <Field label={`${label} stock quantity`}>
        <input
          aria-label={`${label} stock quantity`}
          type="number"
          min="0"
          max="2147483647"
          step="1"
          required
          value={form.stock}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, stock: event.target.value })}
        />
      </Field>
      <Field label={`${label} lead time (days)`}>
        <input
          aria-label={`${label} lead time (days)`}
          type="number"
          min="0"
          max="2147483647"
          step="1"
          required
          value={form.lead}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, lead: event.target.value })}
        />
      </Field>
      <label className="business-checkbox">
        <input
          type="checkbox"
          checked={form.active}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, active: event.target.checked })}
        />
        {label} active
      </label>
    </div>
  );
}
async function upload<T>(path: string, data: FormData): Promise<T> {
  const response = await fetch(path, { method: 'POST', body: data });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        result.error ||
          (result.status === 'failed'
            ? 'CSV validation failed. Review the row errors below.'
            : 'Upload could not be completed.'),
      ),
      { details: result.summary ? result : result.details },
    );
  return result as T;
}
function downloadTemplate() {
  const url = URL.createObjectURL(
    new Blob([`${CSV_HEADERS.join(',')}\r\n`], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'roomsell-catalogue-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
export function CataloguePanel({ context }: { context: WorkspaceContext }) {
  const { organisation, canManage } = context;
  const base = `/api/organisations/${organisation.id}/catalogue`;
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [imports, setImports] = useState<ImportResult[]>([]);
  const [form, setForm] = useState(() => emptyProduct(organisation.currency));
  const [editId, setEditId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState('');
  const [availability, setAvailability] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [assetProductId, setAssetProductId] = useState('');
  const [assetVariantId, setAssetVariantId] = useState('');
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams({
        offset: String(offset),
        ...(searchQuery ? { q: searchQuery } : {}),
        ...(category ? { category } : {}),
      });
      const [catalogue, history] = await Promise.all([
        accountRequest<CatalogueProduct[]>(`${base}?${search}`),
        canManage ? accountRequest<ImportResult[]>(`${base}/import`) : Promise.resolve([]),
      ]);
      setProducts(catalogue);
      setImports(history);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your catalogue.');
    } finally {
      setLoading(false);
    }
  }, [base, canManage, searchQuery, category, offset]);
  useEffect(() => {
    void load();
  }, [load]);
  if (organisation.role === 'customer')
    return <p className="account-muted">Products in your design are available from its project page.</p>;
  const filtered = products.filter((product) => !availability || product.availability === availability);
  const assetProduct = products.find((product) => product.id === assetProductId);
  return (
    <section className="account-panel" aria-label="Retailer catalogue">
      <div>
        <h1>Catalogue</h1>
        <p className="account-muted">
          Authoritative products, variants, prices and dimensions for {organisation.name}.
        </p>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
          <Button disabled={busy} onClick={() => void load()}>
            Reload catalogue
          </Button>
        </p>
      )}
      {message && (
        <p role="status" className="account-notice">
          {message}
        </p>
      )}
      {canManage && (
        <Button
          onClick={() => {
            setEditId(null);
            setForm(emptyProduct(organisation.currency));
            setFormOpen(true);
            setError('');
          }}
          disabled={busy}
        >
          New product
        </Button>
      )}
      {canManage && formOpen && (
        <form
          aria-label="Catalogue product form"
          className="business-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            try {
              const inventory = inventoryInput(form, form.currency);
              delete inventory.id;
              await accountRequest(`${base}${editId ? `/${editId}` : ''}`, {
                method: editId ? 'PATCH' : 'POST',
                body: {
                  ...inventory,
                  category: form.category,
                  currency: form.currency,
                  variants: form.variants.map((variant) => inventoryInput(variant, form.currency)),
                },
              });
              setMessage(editId ? 'Product and variants updated.' : 'Product created.');
              setFormOpen(false);
              setEditId(null);
              await load();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not save this product.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>{editId ? 'Edit product' : 'Create product'}</h2>
          <InventoryFields
            form={form}
            label="Product"
            disabled={busy}
            onChange={(value) => setForm({ ...form, ...value })}
          />
          <div className="business-form-grid">
            <Field label="Product category">
              <select
                aria-label="Product category"
                value={form.category}
                disabled={busy}
                onChange={(event) => setForm({ ...form, category: event.target.value as Category })}
              >
                {['bed', 'wardrobe', 'bedside', 'rug', 'desk'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Product currency">
              <input
                aria-label="Product currency"
                required
                maxLength={3}
                pattern="[A-Z]{3}"
                value={form.currency}
                disabled={busy}
                onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
              />
            </Field>
          </div>
          <p className="account-muted">
            Prices use currency amounts with the currency’s decimal precision; dimensions use metres. In-stock
            products require positive stock to be placed. Stock is checked without reserving inventory.
          </p>
          <h3>Variants</h3>
          <p className="account-muted">
            Without separate variants, saving creates one matching this product. Existing variants keep their
            own prices and dimensions when product fields change.
          </p>
          {form.variants.map((variant, index) => (
            <fieldset className="business-variant" key={variant.id || index}>
              <legend>Variant {index + 1}</legend>
              <InventoryFields
                form={variant}
                label={`Variant ${index + 1}`}
                disabled={busy}
                onChange={(value) =>
                  setForm({ ...form, variants: form.variants.map((item, i) => (i === index ? value : item)) })
                }
              />
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => setForm({ ...form, variants: form.variants.filter((_, i) => i !== index) })}
              >
                Remove variant {index + 1}
              </Button>
            </fieldset>
          ))}
          <div className="business-actions">
            <Button
              type="button"
              disabled={busy || form.variants.length >= 100}
              onClick={() => setForm({ ...form, variants: [...form.variants, emptyInventory()] })}
            >
              Add separate variant
            </Button>
            <Button variant="primary" type="submit" disabled={busy || loading}>
              {busy ? 'Saving…' : editId ? 'Save product' : 'Create product'}
            </Button>
            <Button type="button" disabled={busy} onClick={() => setFormOpen(false)}>
              Cancel product edit
            </Button>
          </div>
        </form>
      )}
      <div className="business-form-grid">
        <Field label="Search catalogue">
          <input
            aria-label="Search catalogue"
            type="search"
            maxLength={100}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Field label="Filter category">
          <select
            aria-label="Filter category"
            value={category}
            disabled={loading}
            onChange={(event) => {
              setCategory(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">All categories</option>
            {['bed', 'wardrobe', 'bedside', 'rug', 'desk'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Filter availability on this page">
          <select
            aria-label="Filter availability on this page"
            value={availability}
            onChange={(event) => setAvailability(event.target.value)}
          >
            <option value="">All availability</option>
            <option value="in_stock">In stock</option>
            <option value="made_to_order">Made to order</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
        </Field>
      </div>
      <Button
        disabled={loading || busy}
        onClick={() => {
          setSearchQuery(query.trim());
          setOffset(0);
        }}
      >
        Search catalogue
      </Button>
      {loading ? (
        <p role="status">Loading catalogue…</p>
      ) : (
        <div className="business-catalogue-grid">
          {filtered.map((product) => (
            <article className="business-product" key={product.id}>
              {product.assets.find((asset) => asset.kind === 'image' && asset.url) ? (
                <img
                  className="business-product-image"
                  src={product.assets.find((asset) => asset.kind === 'image' && asset.url)?.url || ''}
                  alt={product.name}
                  loading="lazy"
                />
              ) : (
                <div
                  className="business-product-proxy"
                  style={{ backgroundColor: product.color }}
                  aria-label="Dimension proxy"
                >
                  <span>{product.category}</span>
                  <small>
                    {product.dimensions.width} × {product.dimensions.depth} × {product.dimensions.height} m
                  </small>
                </div>
              )}
              <div>
                <h2>{product.name}</h2>
                <p className="account-muted">
                  {product.sku} · {product.category}
                  {!product.active && ' · Archived'}
                </p>
                <p>{formatMoney(product.priceMinor, product.currency)}</p>
                <p className="account-muted">
                  {product.availability.replaceAll('_', ' ')} · {product.stockQuantity} in stock ·{' '}
                  {product.leadTimeDays} day lead time
                </p>
              </div>
              <details>
                <summary>
                  {product.variants.length} {product.variants.length === 1 ? 'variant' : 'variants'}
                </summary>
                <ul className="business-variant-list">
                  {product.variants.map((variant) => (
                    <li key={variant.id}>
                      <strong>{variant.name}</strong> · {variant.sku}
                      <span>
                        {formatMoney(variant.priceMinor, product.currency)} · {variant.dimensions.width} ×{' '}
                        {variant.dimensions.depth} × {variant.dimensions.height} m
                      </span>
                      <span>
                        {variant.availability.replaceAll('_', ' ')} · {variant.stockQuantity} in stock
                        {!variant.active && ' · Inactive'}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
              {!!product.assets.length && (
                <ul className="business-asset-list">
                  {product.assets.map((asset) => (
                    <li key={asset.id}>
                      {asset.kind === 'model' ? 'Validated model' : 'Photograph'} ·{' '}
                      {Math.round(asset.sizeBytes / 1024)} KiB{' '}
                      {asset.url && (
                        <a href={asset.url} target="_blank" rel="noreferrer">
                          Open asset
                        </a>
                      )}
                      {canManage && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            try {
                              await accountRequest(`${base}/${product.id}/assets/${asset.id}`, {
                                method: 'DELETE',
                              });
                              setMessage('Asset removed.');
                              await load();
                            } catch (reason) {
                              setError(
                                reason instanceof Error ? reason.message : 'Could not remove the asset.',
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Remove asset
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canManage && (
                <div className="business-actions">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditId(product.id);
                      setForm({
                        ...inventoryForm(product, product.currency),
                        category: product.category,
                        currency: product.currency,
                        variants: product.variants.map((variant) => inventoryForm(variant, product.currency)),
                      });
                      setFormOpen(true);
                    }}
                  >
                    Edit {product.name}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setAssetProductId(product.id);
                      setAssetVariantId('');
                    }}
                  >
                    Add assets
                  </Button>
                  {product.active &&
                    (archiveId === product.id ? (
                      <div className="business-confirm">
                        <p>Archive this product? Saved designs retain their measured furniture snapshots.</p>
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            try {
                              await accountRequest(`${base}/${product.id}`, { method: 'DELETE' });
                              setArchiveId(null);
                              setMessage('Product archived.');
                              await load();
                            } catch (reason) {
                              setError(
                                reason instanceof Error ? reason.message : 'Could not archive the product.',
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Confirm archive
                        </Button>
                        <Button disabled={busy} onClick={() => setArchiveId(null)}>
                          Keep product
                        </Button>
                      </div>
                    ) : (
                      <Button variant="danger" disabled={busy} onClick={() => setArchiveId(product.id)}>
                        Archive {product.name}
                      </Button>
                    ))}
                </div>
              )}
            </article>
          ))}
          {!filtered.length && (
            <p className="account-empty">
              {products.length
                ? 'No products match these filters.'
                : 'Add your real retailer products or upload a catalogue CSV to begin.'}
            </p>
          )}
        </div>
      )}
      <div className="business-actions" aria-label="Catalogue pages">
        <Button
          disabled={loading || busy || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous catalogue page
        </Button>
        <span className="account-muted">
          Page {Math.floor(offset / 100) + 1} · up to 100 products per page
        </span>
        <Button
          disabled={loading || busy || products.length < 100 || offset >= 100000}
          onClick={() => setOffset(offset + 100)}
        >
          Next catalogue page
        </Button>
      </div>
      {canManage && (
        <details className="account-details">
          <summary>Import catalogue CSV</summary>
          <div className="business-form">
            <p className="account-muted">
              UTF-8 CSV, up to 1 MiB and 500 data rows. One variant per row; repeat the product SKU to group
              variants. Prices use integer minor units and dimensions use metres. Existing or duplicate SKUs
              reject the whole import; no products are saved from a failed file.
            </p>
            <Button onClick={downloadTemplate}>Download blank CSV template</Button>
            <form
              className="business-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!file) return;
                setBusy(true);
                setError('');
                setImportResult(null);
                try {
                  if (file.size > 1024 * 1024) throw new Error('CSV exceeds the 1 MiB limit.');
                  const data = new FormData();
                  data.set('file', file);
                  const result = await upload<ImportResult>(`${base}/import`, data);
                  setImportResult(result);
                  setMessage('Catalogue import completed.');
                  await load();
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Import failed.');
                  if (reason && typeof reason === 'object' && 'details' in reason) {
                    const details = reason.details as ImportResult;
                    if (details?.summary) setImportResult(details);
                  }
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Catalogue CSV file">
                <input
                  aria-label="Catalogue CSV file"
                  type="file"
                  accept=".csv,text/csv"
                  required
                  disabled={busy}
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </Field>
              <Button type="submit" variant="primary" disabled={!file || busy}>
                {busy ? 'Checking import…' : 'Validate and import CSV'}
              </Button>
            </form>
            {importResult && <ImportSummary result={importResult} />}
            <h3>Import history</h3>
            {imports.length ? (
              imports.map((result) => <ImportSummary key={result.id} result={result} />)
            ) : (
              <p className="account-muted">No imports yet.</p>
            )}
          </div>
        </details>
      )}
      {canManage && assetProduct && (
        <section className="business-form" aria-label="Product asset upload">
          <h2>Assets for {assetProduct.name}</h2>
          <p className="account-muted">
            PNG, JPEG or WebP photographs up to 10 MiB; GLB or self-contained glTF models up to 20 MiB. Models
            must match the selected product dimensions in metres. Validation checks file content, embedded
            resources, geometry bounds and performance limits before private storage.
          </p>
          <form
            className="business-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!assetFile) return;
              setBusy(true);
              setError('');
              try {
                if (assetFile.size > 20 * 1024 * 1024) throw new Error('Asset exceeds the 20 MiB limit.');
                const data = new FormData();
                data.set('file', assetFile);
                if (assetVariantId) data.set('variantId', assetVariantId);
                await upload(`${base}/${assetProduct.id}/assets`, data);
                setMessage('Asset validated and uploaded.');
                setAssetFile(null);
                await load();
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Asset validation failed.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Asset variant">
              <select
                aria-label="Asset variant"
                disabled={busy}
                value={assetVariantId}
                onChange={(event) => setAssetVariantId(event.target.value)}
              >
                <option value="">Whole product</option>
                {assetProduct.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.name} · {variant.sku}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Product asset file">
              <input
                aria-label="Product asset file"
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.glb,.gltf"
                required
                disabled={busy}
                onChange={(event) => setAssetFile(event.target.files?.[0] || null)}
              />
            </Field>
            <div className="business-actions">
              <Button type="submit" variant="primary" disabled={busy || !assetFile}>
                {busy ? 'Validating…' : 'Validate and upload asset'}
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAssetProductId('');
                  setAssetFile(null);
                }}
              >
                Close assets
              </Button>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}
function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <div className="business-import-result">
      <strong>
        {result.fileName || 'Catalogue import'} · {result.status}
      </strong>
      <p>
        {result.summary.rowCount} rows · {result.summary.productCount || 0} products ·{' '}
        {result.summary.variantCount || 0} variants
      </p>
      {!!result.summary.errors?.length && (
        <ul>
          {result.summary.errors.map((error, index) => (
            <li key={index}>
              Row {error.row}
              {error.field || error.column ? ` · ${error.field || error.column}` : ''}: {error.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
