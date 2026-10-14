'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { accountRequest, type WorkspaceContext } from './workspace-frame';
import type { CatalogueProduct } from './workspace-business-types';
interface Publication {
  id: string;
  variant_id: string;
  revision: number;
  enabled: boolean;
  image_ids: string[];
}
export function PublicationPanel({ context }: { context: WorkspaceContext }) {
  const [products, setProducts] = useState<CatalogueProduct[]>([]),
    [publications, setPublications] = useState<Publication[]>([]),
    [variantId, setVariantId] = useState(''),
    [imageIds, setImageIds] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [offset, setOffset] = useState(0);
  const path = `/api/organisations/${context.organisation.id}/publications`;
  const load = useCallback(async () => {
    try {
      const [catalogue, records] = await Promise.all([
        accountRequest<CatalogueProduct[]>(
          `/api/organisations/${context.organisation.id}/catalogue?offset=${offset}`,
        ),
        accountRequest<Publication[]>(path),
      ]);
      setProducts(catalogue);
      setPublications(records);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Publication could not be loaded.');
    }
  }, [context.organisation.id, offset, path]);
  useEffect(() => {
    void load();
  }, [load]);
  const selected = products
      .flatMap((product) => product.variants.map((variant) => ({ product, variant })))
      .find((item) => item.variant.id === variantId),
    record = publications.find((item) => item.variant_id === variantId);
  const images =
    selected?.product.assets.filter(
      (asset) => asset.kind === 'image' && (!asset.variantId || asset.variantId === variantId),
    ) ?? [];
  async function save(enabled: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await accountRequest(path, {
        method: 'PUT',
        body: {
          variantId,
          expectedRevision: record?.revision ?? 0,
          enabled,
          imageIds: enabled ? imageIds : [],
        },
      });
      await load();
      setConsent(false);
      setMessage(
        enabled
          ? 'Selected offer published. Private projects and room photographs remain private.'
          : 'Offer unpublished. Public access to its selected images is revoked.',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Publication failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-panel" aria-label="Marketplace publication">
      <h1>Marketplace publication</h1>
      <p className="account-muted">
        Publish specific product variants and selected catalogue images. This grants public access to their
        current details and tax-inclusive listed price. Room photographs, customers, inventory quantities and
        private projects are never published.
      </p>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <Field label="Variant to publish">
        <select
          aria-label="Variant to publish"
          value={variantId}
          disabled={busy}
          onChange={(event) => {
            const id = event.target.value;
            setVariantId(id);
            setImageIds(publications.find((item) => item.variant_id === id)?.image_ids ?? []);
            setConsent(false);
          }}
        >
          <option value="">Choose a catalogue variant</option>
          {products.flatMap((product) =>
            product.variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {product.name} — {variant.name} · {variant.sku}
                {publications.some((item) => item.variant_id === variant.id && item.enabled)
                  ? ' · published'
                  : ''}
              </option>
            )),
          )}
        </select>
      </Field>
      <div className="business-form-row">
        <Button
          disabled={busy || offset === 0}
          onClick={() => {
            setOffset(Math.max(0, offset - 100));
            setVariantId('');
          }}
        >
          Previous catalogue page
        </Button>
        <Button
          disabled={busy || products.length < 100}
          onClick={() => {
            setOffset(offset + 100);
            setVariantId('');
          }}
        >
          Next catalogue page
        </Button>
      </div>
      {selected && (
        <>
          <h2>{selected.product.name}</h2>
          <p>Current status: {record?.enabled ? 'Published' : 'Private'}</p>
          <div className="business-card-list">
            {images.map((image) => (
              <label className="business-record" key={image.id}>
                <input
                  type="checkbox"
                  checked={imageIds.includes(image.id)}
                  onChange={(event) =>
                    setImageIds(
                      event.target.checked
                        ? [...imageIds, image.id]
                        : imageIds.filter((id) => id !== image.id),
                    )
                  }
                  disabled={busy || (!imageIds.includes(image.id) && imageIds.length >= 4)}
                />
                <img className="business-item-image" src={image.url} alt={selected.product.name} />
                <span>Publish this catalogue image</span>
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              disabled={busy}
            />{' '}
            I approve public publication of this product variant, its current price and the selected images.
          </label>
          <Button
            variant="primary"
            disabled={!consent || busy || !selected.product.active || !selected.variant.active}
            onClick={() => void save(true)}
          >
            Publish selected offer
          </Button>
          {record?.enabled && (
            <Button disabled={busy} onClick={() => void save(false)}>
              Unpublish selected offer
            </Button>
          )}
        </>
      )}
      <a className="business-text-link" href="/marketplace">
        View public marketplace
      </a>
    </section>
  );
}
