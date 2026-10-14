'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { Editor } from './editor';
import { useEditor } from '../lib/editor-store';
import { accountRequest } from './workspace-frame';
import { formatMoney } from './workspace-business-types';
import type { PublicOffer } from '../lib/marketplace-service';
import './workspace-business.css';
interface PersonalProject {
  id: string;
  name: string;
  currency: string;
  budgetMinor: number;
  version: number;
}
export function ConsumerEditor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<PersonalProject | null>(null),
    [offers, setOffers] = useState<PublicOffer[]>([]),
    [selected, setSelected] = useState(''),
    [x, setX] = useState(''),
    [z, setZ] = useState(''),
    [error, setError] = useState(''),
    [enquiry, setEnquiry] = useState<{ projectId: string } | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0);
  const { scene, endpoint, proposal, busy: editing, preview } = useEditor();
  const base = `/api/consumer/projects/${projectId}`;
  const current = endpoint === base + '/scene' ? scene : null;
  const load = useCallback(async () => {
    try {
      const [details, items] = await Promise.all([
        accountRequest<PersonalProject>(base),
        accountRequest<PublicOffer[]>(`/api/marketplace/offers?offset=${offset}`),
      ]);
      setProject(details);
      const requested = new URLSearchParams(window.location.search).get('offer');
      if (requested && !items.some((item) => item.id === requested)) {
        try {
          items.push(await accountRequest<PublicOffer>(`/api/marketplace/offers/${requested}`));
        } catch {
          /*Revoked offers stay unavailable.*/
        }
      }
      setOffers(items);
      if (requested) setSelected(requested);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Personal design unavailable.');
    }
  }, [base, offset]);
  useEffect(() => {
    void load();
  }, [load]);
  const chosen = offers.find((offer) => offer.id === selected);
  const retailers = [
    ...new Set(
      current?.objects
        .map((object) => offers.find((offer) => offer.variantId === object.variantId)?.organisationId)
        .filter((id): id is string => Boolean(id)) ?? [],
    ),
  ];
  if (!project)
    return (
      <main className="account-loading">
        {error || 'Opening your private design…'}
        <Link href="/marketplace">Back to marketplace</Link>
      </main>
    );
  return (
    <div className="project-business-page">
      <Editor
        projectId={projectId}
        personal
        endpoint={base + '/scene'}
        title={project.name}
        subtitle="Personal design · visible only to your account"
      />
      <div className="project-business-tools">
        <section className="account-panel" aria-label="Personal design products">
          <h2>Furnish your personal room</h2>
          <p>
            Budget: {formatMoney(project.budgetMinor, project.currency)}. Published product estimates exclude
            retailer delivery and installation charges.
          </p>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <form
            className="business-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!current || !chosen) return;
              void preview({
                type: 'add-object',
                object: {
                  id: crypto.randomUUID(),
                  variantId: chosen.variantId,
                  sku: chosen.sku,
                  name: chosen.name,
                  category: chosen.category,
                  dimensions: chosen.dimensions,
                  color: chosen.color,
                  solid: chosen.category !== 'rug',
                  locks: { position: false, rotation: false, product: false },
                  transform: {
                    x: x === '' ? current.room.width / 2 : Number(x),
                    y: 0,
                    z: z === '' ? current.room.depth / 2 : Number(z),
                    rotation: 0,
                  },
                },
              });
            }}
          >
            <Field label="Published furniture variant">
              <select
                aria-label="Published furniture variant"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                required
              >
                <option value="">Choose a published offer</option>
                {offers
                  .filter((offer) => offer.available && offer.currency === project.currency)
                  .map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.name} — {offer.retailer} · {formatMoney(offer.priceMinor, offer.currency)}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="business-form-row">
              <Field label="Personal placement X (m)">
                <input
                  aria-label="Personal placement X (m)"
                  type="number"
                  step="0.1"
                  value={x}
                  onChange={(event) => setX(event.target.value)}
                />
              </Field>
              <Field label="Personal placement Z (m)">
                <input
                  aria-label="Personal placement Z (m)"
                  type="number"
                  step="0.1"
                  value={z}
                  onChange={(event) => setZ(event.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" disabled={!chosen || !current || editing || Boolean(proposal)}>
              Preview published furniture
            </Button>
          </form>
          <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Previous offer page
          </Button>
          <Button disabled={offers.length < 50} onClick={() => setOffset(offset + 50)}>
            Next offer page
          </Button>
          {chosen?.fictional && (
            <p className="account-notice">This selected product belongs to a fictional test retailer.</p>
          )}
        </section>
        <section className="account-panel" aria-label="Share with a retailer">
          <h2>Request a retailer quotation</h2>
          <p>
            Choose a retailer already present in your design. Sharing creates a separate retailer project
            containing the measured room and that retailer’s selected furniture, along with your account name
            and email. Your private design and other retailers’ products stay private.
          </p>
          <label>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{' '}
            I approve sharing these details with the selected retailer.
          </label>
          {retailers.map((orgId) => (
            <Button
              key={orgId}
              disabled={!consent || busy || editing || !!proposal}
              onClick={async () => {
                if (!current) return;
                setBusy(true);
                setError('');
                try {
                  setEnquiry(
                    await accountRequest<{ projectId: string }>(base + '/enquiries', {
                      method: 'POST',
                      body: { organisationId: orgId, expectedVersion: current.version },
                    }),
                  );
                  setConsent(false);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Could not request a quotation.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Request quotation from {offers.find((offer) => offer.organisationId === orgId)?.retailer}
            </Button>
          ))}
          {!retailers.length && (
            <p>Add and accept published furniture before requesting a retailer quotation.</p>
          )}
          {enquiry && (
            <p role="status">
              Enquiry created.{' '}
              <Link href={`/projects/${enquiry.projectId}`}>Open your shared retailer project</Link>
            </p>
          )}
        </section>
        <Link className="business-text-link" href="/marketplace">
          Back to marketplace
        </Link>
      </div>
    </div>
  );
}
