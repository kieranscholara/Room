'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { isCatalogueVariantAvailable, type SelectedProjectProducts } from '@roomsell/catalogue';
import { Editor } from './editor';
import { ProjectQuotations } from './project-quotations';
import { useEditor } from '../lib/editor-store';
import { AccountRequestError, accountRequest, type OrganisationRole } from './workspace-frame';
import { formatMoney, type CatalogueProduct, type ProjectRecord } from './workspace-business-types';
import './workspace-business.css';

interface ProjectDetails extends ProjectRecord {
  canEdit: boolean;
  role: OrganisationRole;
}
interface CustomerMember {
  userId: string;
  email: string;
  role: OrganisationRole;
}
interface Access {
  userId: string;
  canEdit: boolean;
}
export function ProjectEditor({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setProject(await accountRequest<ProjectDetails>(`/api/projects/${projectId}`));
    } catch (reason) {
      if (reason instanceof AccountRequestError && reason.status === 401)
        router.replace(`/auth/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
      else setError(reason instanceof Error ? reason.message : 'Could not open your project.');
    }
  }, [projectId, router]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!project)
    return (
      <main className="account-loading">
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button onClick={() => void load()}>Retry project</Button>
            <Link className="business-text-link" href="/workspace?panel=projects">
              Back to projects
            </Link>
          </div>
        ) : (
          <p role="status">Opening project…</p>
        )}
      </main>
    );
  return (
    <div className="project-business-page">
      <Editor
        projectId={projectId}
        title={project.name}
        subtitle={`${project.roomType.replace('_', ' ')}${project.style ? ` · ${project.style}` : ''}`}
        readOnly={!project.canEdit}
      />
      <div className="project-business-tools">
        <ProjectProducts key={projectId} project={project} />
        <ProjectQuotations
          key={`quotes-${projectId}`}
          projectId={projectId}
          organisationId={project.organisationId}
          role={project.role}
        />
        {['owner', 'admin'].includes(project.role) && <ProjectAccess project={project} />}
        <Link
          className="business-text-link"
          href={`/workspace?organisation=${project.organisationId}&panel=projects`}
        >
          Back to organisation projects
        </Link>
      </div>
    </div>
  );
}
function ProjectProducts({ project }: { project: ProjectDetails }) {
  const { scene, endpoint, busy, proposal, selectedId, preview, select } = useEditor();
  const current = endpoint === `/api/projects/${project.id}/scene` ? scene : null;
  const [catalogue, setCatalogue] = useState<CatalogueProduct[]>([]);
  const [selected, setSelected] = useState<SelectedProjectProducts | null>(null);
  const [error, setError] = useState('');
  const [variantId, setVariantId] = useState('');
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [x, setX] = useState('');
  const [z, setZ] = useState('');
  const [rotation, setRotation] = useState('0');
  const staff = project.role !== 'customer';
  const load = useCallback(async () => {
    setCatalogueLoading(true);
    try {
      const [items, products] = await Promise.all([
        accountRequest<SelectedProjectProducts>(`/api/projects/${project.id}/products`),
        staff
          ? accountRequest<CatalogueProduct[]>(
              `/api/organisations/${project.organisationId}/catalogue?${new URLSearchParams({ offset: String(offset), ...(searchQuery ? { q: searchQuery } : {}) })}`,
            )
          : Promise.resolve([]),
      ]);
      setSelected(items);
      setCatalogue(products);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load project products.');
    } finally {
      setCatalogueLoading(false);
    }
  }, [project.id, project.organisationId, staff, searchQuery, offset]);
  useEffect(() => {
    if (current) void load();
  }, [load, current?.version, current?.id]);
  const variants = catalogue
    .flatMap((product) => product.variants.map((variant) => ({ product, variant })))
    .filter(
      ({ product, variant }) =>
        product.currency === project.currency && isCatalogueVariantAvailable(product, variant),
    );
  const chosen = variants.find(({ variant }) => variant.id === variantId);
  const selectedObject = current?.objects.find((object) => object.id === selectedId);
  return (
    <section className="account-panel" aria-label="Project catalogue and budget">
      <div>
        <h2>Products and budget</h2>
        <p className="account-muted">
          Current catalogue prices for accepted furniture. A preview updates these totals when accepted.
        </p>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy} onClick={() => void load()}>
        Refresh product prices and assets
      </Button>
      {selected && (
        <>
          <div className="business-budget" aria-label="Project budget totals">
            <div>
              <span>Catalogue subtotal</span>
              <strong>
                {selected.totalMinor === null
                  ? 'Requires catalogue review'
                  : formatMoney(selected.totalMinor, selected.currency)}
              </strong>
            </div>
            <div>
              <span>Project budget</span>
              <strong>{formatMoney(selected.budgetMinor, selected.currency)}</strong>
            </div>
            {selected.totalMinor !== null && (
              <div>
                <span>{selected.overBudget ? 'Over budget' : 'Budget remaining'}</span>
                <strong>
                  {formatMoney(Math.abs(selected.budgetMinor - selected.totalMinor), selected.currency)}
                </strong>
              </div>
            )}
          </div>
          {selected.overBudget && (
            <p className="account-error" role="status">
              The selected catalogue subtotal exceeds this project’s budget.
            </p>
          )}
          {selected.stale && (
            <p className="account-error" role="status">
              Some saved furniture differs from current catalogue data. Its saved measurements remain
              unchanged; review the marked items before ordering.
            </p>
          )}
          <p className="account-muted">
            Catalogue subtotal only. Taxes, delivery, discounts, quotations and inventory reservations are
            handled separately.
          </p>
          <div className="business-card-list">
            {selected.items.map((item) => (
              <article className="business-record" key={item.objectId}>
                {item.assets.find((asset) => asset.kind === 'image' && asset.url) && (
                  <img
                    className="business-item-image"
                    alt={item.name}
                    src={item.assets.find((asset) => asset.kind === 'image' && asset.url)?.url || ''}
                    loading="lazy"
                  />
                )}
                <div>
                  <h3>{item.name}</h3>
                  <p className="account-muted">
                    {item.sku}
                    {item.variantName && item.variantName !== item.name ? ` · ${item.variantName}` : ''}
                  </p>
                  <p>
                    {item.priceMinor === null
                      ? 'Price unavailable'
                      : formatMoney(item.priceMinor, item.currency)}
                  </p>
                  {item.stale && <p className="business-warning">Catalogue details changed</p>}
                  {!item.available && <p className="business-warning">Unavailable for new placement</p>}
                  {item.assets
                    .filter((asset) => asset.kind === 'model' && asset.url)
                    .map((asset) => (
                      <a
                        className="business-text-link"
                        key={asset.id}
                        href={asset.url || ''}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open validated model file
                      </a>
                    ))}
                </div>
                <Button onClick={() => select(item.objectId)}>Select {item.name}</Button>
              </article>
            ))}
            {!selected.items.length && (
              <p className="account-empty">This measured room has no accepted furniture yet.</p>
            )}
          </div>
        </>
      )}
      {staff && project.canEdit && (
        <form
          className="business-form"
          aria-label="Place catalogue furniture"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!chosen || !current) return;
            setError('');
            const { product, variant } = chosen;
            const objectId = crypto.randomUUID();
            await preview({
              type: 'add-object',
              object: {
                id: objectId,
                sku: variant.sku,
                variantId: variant.id,
                name: product.name,
                category: product.category,
                dimensions: variant.dimensions,
                color: variant.color,
                solid: product.category !== 'rug',
                locks: { position: false, rotation: false, product: false },
                transform: {
                  x: x === '' ? current.room.width / 2 : Number(x),
                  y: 0,
                  z: z === '' ? current.room.depth / 2 : Number(z),
                  rotation: (Number(rotation) * Math.PI) / 180,
                },
              },
            });
            select(objectId);
          }}
        >
          <h3>Add real catalogue furniture</h3>
          <p className="account-muted">
            Choose an available variant, then review its checked placement in the editor. The room stays
            unchanged until you accept the preview.
          </p>
          <div className="business-form-grid">
            <Field label="Find catalogue furniture">
              <input
                aria-label="Find catalogue furniture"
                type="search"
                maxLength={100}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={busy || !!proposal}
              />
            </Field>
            <Button
              type="button"
              disabled={catalogueLoading || busy || !!proposal}
              onClick={() => {
                setSearchQuery(query.trim());
                setOffset(0);
                setVariantId('');
              }}
            >
              Search catalogue furniture
            </Button>
            <Field label="Furniture variant">
              <select
                aria-label="Furniture variant"
                required
                value={variantId}
                onChange={(event) => setVariantId(event.target.value)}
                disabled={catalogueLoading || busy || !!proposal}
              >
                <option value="">Choose a catalogue variant</option>
                {variants.map(({ product, variant }) => (
                  <option key={variant.id} value={variant.id}>
                    {product.name} · {variant.name} · {variant.sku} ·{' '}
                    {formatMoney(variant.priceMinor, product.currency)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="New furniture X (m)">
              <input
                aria-label="New furniture X (m)"
                type="number"
                min="0"
                step="0.01"
                max={current?.room.width}
                value={x}
                placeholder={String((current?.room.width || 0) / 2)}
                disabled={busy || !!proposal}
                onChange={(event) => setX(event.target.value)}
              />
            </Field>
            <Field label="New furniture Z (m)">
              <input
                aria-label="New furniture Z (m)"
                type="number"
                min="0"
                step="0.01"
                max={current?.room.depth}
                value={z}
                placeholder={String((current?.room.depth || 0) / 2)}
                disabled={busy || !!proposal}
                onChange={(event) => setZ(event.target.value)}
              />
            </Field>
            <Field label="New furniture rotation (degrees)">
              <input
                aria-label="New furniture rotation (degrees)"
                type="number"
                required
                min="-360"
                max="360"
                step="1"
                value={rotation}
                disabled={busy || !!proposal}
                onChange={(event) => setRotation(event.target.value)}
              />
            </Field>
          </div>
          <div className="business-actions">
            <Button
              type="button"
              disabled={catalogueLoading || busy || !!proposal || offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - 100));
                setVariantId('');
              }}
            >
              Previous furniture page
            </Button>
            <span className="account-muted">Page {Math.floor(offset / 100) + 1}</span>
            <Button
              type="button"
              disabled={catalogueLoading || busy || !!proposal || catalogue.length < 100 || offset >= 100000}
              onClick={() => {
                setOffset(offset + 100);
                setVariantId('');
              }}
            >
              Next furniture page
            </Button>
          </div>
          {chosen && (
            <p className="account-muted">
              {chosen.variant.dimensions.width} × {chosen.variant.dimensions.depth} ×{' '}
              {chosen.variant.dimensions.height} m · {chosen.variant.material || 'Material unspecified'}.
              Empty coordinates use the room centre.
            </p>
          )}
          <Button
            variant="primary"
            type="submit"
            disabled={
              !chosen || !current || catalogueLoading || busy || !!proposal || current.objects.length >= 30
            }
          >
            Preview catalogue placement
          </Button>
          {!variants.length && (
            <Link
              className="business-text-link"
              href={`/workspace?organisation=${project.organisationId}&panel=catalogue`}
            >
              Add available products to this organisation’s catalogue
            </Link>
          )}
        </form>
      )}
      {project.canEdit && selectedObject && (
        <div className="business-actions">
          <Button
            variant="danger"
            disabled={busy || !!proposal || selectedObject.locks.product}
            onClick={() => void preview({ type: 'remove-object', objectId: selectedObject.id })}
          >
            Preview removal of {selectedObject.name}
          </Button>
          {selectedObject.locks.product && (
            <p className="account-muted">Unlock this product before removing it.</p>
          )}
        </div>
      )}
    </section>
  );
}
function ProjectAccess({ project }: { project: ProjectDetails }) {
  const [members, setMembers] = useState<CustomerMember[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [userId, setUserId] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try {
      const [people, grants] = await Promise.all([
        accountRequest<CustomerMember[]>(`/api/organisations/${project.organisationId}/members`),
        accountRequest<Access[]>(`/api/projects/${project.id}/access`),
      ]);
      setMembers(people.filter((person) => person.role === 'customer'));
      setAccess(grants);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load project access.');
    }
  }, [project.organisationId, project.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="account-panel" aria-label="Project customer access">
      <div>
        <h2>Customer access</h2>
        <p className="account-muted">
          Share only this project with a customer who has joined your organisation. Staff access follows their
          team role.
        </p>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="account-notice" role="status">
          {message}
        </p>
      )}
      <form
        className="business-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!userId) return;
          setBusy(true);
          setError('');
          try {
            await accountRequest(`/api/projects/${project.id}/access`, {
              method: 'POST',
              body: { userId, canEdit },
            });
            setMessage('Project access saved.');
            await load();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not grant access.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Customer account">
          <select
            aria-label="Customer account"
            required
            value={userId}
            disabled={busy}
            onChange={(event) => {
              const id = event.target.value;
              setUserId(id);
              setCanEdit(access.find((grant) => grant.userId === id)?.canEdit || false);
            }}
          >
            <option value="">Choose a joined customer</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.email}
              </option>
            ))}
          </select>
        </Field>
        <label className="business-checkbox">
          <input
            type="checkbox"
            checked={canEdit}
            disabled={busy}
            onChange={(event) => setCanEdit(event.target.checked)}
          />
          Allow this customer to edit their design
        </label>
        <Button variant="primary" type="submit" disabled={busy || !userId}>
          Save customer access
        </Button>
      </form>
      <div className="business-card-list">
        {access.map((grant) => (
          <div className="business-record" key={grant.userId}>
            <p>
              {members.find((member) => member.userId === grant.userId)?.email || 'Customer account'} ·{' '}
              {grant.canEdit ? 'Can edit' : 'View only'}
            </p>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await accountRequest(`/api/projects/${project.id}/access?userId=${grant.userId}`, {
                    method: 'DELETE',
                  });
                  setMessage('Customer access removed.');
                  await load();
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Could not remove access.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove customer access
            </Button>
          </div>
        ))}
      </div>
      {!members.length && (
        <Link
          className="business-text-link"
          href={`/workspace?organisation=${project.organisationId}&panel=team`}
        >
          Invite a customer from Team before sharing this project
        </Link>
      )}
    </section>
  );
}
