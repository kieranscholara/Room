'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@roomsell/ui';
import type { QuotationPricing } from '@roomsell/pricing';
import type { IssuedQuotation, QuotationSource, RetailerPricingPolicy } from '../lib/quotation-schemas';
import { useEditor } from '../lib/editor-store';
import { accountRequest, type OrganisationRole } from './workspace-frame';
import { formatMoney } from './workspace-business-types';
import type { PhotoProof } from '../lib/photo-image-contract';

interface Preview {
  source: QuotationSource;
  calculation: QuotationPricing;
  sourceFingerprint: string;
  photo?: PhotoProof;
}
function QuoteAmounts({ calculation }: { calculation: QuotationPricing }) {
  const money = (value: number) => formatMoney(value, calculation.policy.currency);
  return (
    <div>
      <div className="business-card-list">
        {calculation.lines.map((line) => (
          <article className="business-record" key={line.variantId}>
            <div>
              <strong>{line.name}</strong>
              <p>
                {line.sku} · quantity {line.quantity} · {money(line.unitPriceMinor)} each
              </p>
            </div>
            <strong>{money(line.totalMinor)}</strong>
          </article>
        ))}
      </div>
      <dl className="business-budget">
        <div>
          <dt>Listed furniture subtotal</dt>
          <dd>{money(calculation.totals.subtotalMinor)}</dd>
        </div>
        <div>
          <dt>Furniture discount</dt>
          <dd>{money(calculation.totals.discountMinor)}</dd>
        </div>
        <div>
          <dt>Delivery including applicable tax</dt>
          <dd>{money(calculation.totals.deliveryMinor)}</dd>
        </div>
        <div>
          <dt>Installation including applicable tax</dt>
          <dd>{money(calculation.totals.installationMinor)}</dd>
        </div>
        <div>
          <dt>Net total</dt>
          <dd>{money(calculation.totals.netMinor)}</dd>
        </div>
        <div>
          <dt>Tax</dt>
          <dd>{money(calculation.totals.taxMinor)}</dd>
        </div>
        <div>
          <dt>Quotation total</dt>
          <dd>
            <strong>{money(calculation.totals.grandTotalMinor)}</strong>
          </dd>
        </div>
      </dl>
    </div>
  );
}
export function ProjectQuotations({
  projectId,
  organisationId,
  role,
  canPrepareQuote = true,
  photoProof,
}: {
  projectId: string;
  organisationId: string;
  role: OrganisationRole;
  canPrepareQuote?: boolean;
  photoProof?: PhotoProof;
}) {
  const { scene, endpoint, proposal, busy: sceneBusy } = useEditor();
  const current = endpoint === `/api/projects/${projectId}/scene` ? scene : null;
  const [quotes, setQuotes] = useState<IssuedQuotation[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pricing, setPricing] = useState<RetailerPricingPolicy | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [issueKey, setIssueKey] = useState<string | null>(null);
  const staff = role !== 'customer';
  const load = useCallback(async () => {
    try {
      const [items, policy] = await Promise.all([
        accountRequest<IssuedQuotation[]>(`/api/projects/${projectId}/quotations`),
        staff
          ? accountRequest<RetailerPricingPolicy | null>(`/api/organisations/${organisationId}/pricing`)
          : Promise.resolve(null),
      ]);
      setQuotes(items);
      setPricing(policy);
      setLoaded(true);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load quotations.');
    }
  }, [projectId, organisationId, staff]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setPreview(null);
    setIssueKey(null);
  }, [
    current?.version,
    current?.id,
    canPrepareQuote,
    photoProof?.referenceId,
    photoProof?.compositionRevision,
    photoProof?.imageSha256,
  ]);
  const canReview =
    canPrepareQuote && staff && current && current.objects.length > 0 && !proposal && !sceneBusy && pricing;
  const chosen = quotes.find((quote) => quote.id === selected);
  const previewMatchesPhoto =
    preview?.photo?.referenceId === photoProof?.referenceId &&
    preview?.photo?.compositionRevision === photoProof?.compositionRevision &&
    preview?.photo?.imageSha256 === photoProof?.imageSha256;
  return (
    <section className="account-panel" aria-label="Project quotations">
      <div>
        <h2>Quotations</h2>
        <p className="account-muted">
          Issued quotations preserve the accepted design, catalogue prices and retailer pricing rules at
          issuance. Inventory is checked at issuance; a quotation does not reserve stock.
        </p>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {staff && loaded && !pricing && (
        <p>
          Configure retailer pricing rules before reviewing a quotation.{' '}
          {['owner', 'admin'].includes(role) && (
            <Link href={`/workspace?organisation=${organisationId}&panel=pricing`}>Set pricing rules</Link>
          )}
        </p>
      )}
      {staff && !canPrepareQuote && (
        <p className="account-notice">
          Confirm the client’s chosen furniture and positions above before preparing a new quotation.
        </p>
      )}
      {staff && (
        <Button
          disabled={!canReview || busy}
          onClick={async () => {
            if (!current || !pricing || !canPrepareQuote) return;
            setBusy(true);
            setError('');
            setPreview(null);
            setIssueKey(null);
            try {
              const result = await accountRequest<Preview>(`/api/projects/${projectId}/quotations/preview`, {
                method: 'POST',
                body: {
                  expectedSceneVersion: current.version,
                  expectedPolicyRevision: pricing.revision,
                  ...(photoProof ? { photo: photoProof } : {}),
                },
              });
              setPreview(result);
              setIssueKey(crypto.randomUUID());
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not calculate quotation.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Review quotation
        </Button>
      )}
      <Button disabled={busy} onClick={() => void load()}>
        Refresh quotations and pricing
      </Button>
      {preview &&
        previewMatchesPhoto &&
        canPrepareQuote &&
        preview.source.sceneVersion === current?.version && (
          <div role="region" aria-label="Quotation preview">
            <h3>Review quotation · design revision {preview.source.sceneVersion}</h3>
            <QuoteAmounts calculation={preview.calculation} />
            <p className="account-muted">
              Tax {preview.source.policy.taxRateBps / 100}% ·{' '}
              {preview.source.policy.taxMode === 'inclusive'
                ? 'included in listed prices'
                : 'added to listed prices'}{' '}
              · {preview.source.policy.rounding === 'invoice' ? 'invoice rounding' : 'per-line rounding'}
            </p>
            <Button
              variant="primary"
              disabled={
                busy ||
                !issueKey ||
                Boolean(proposal) ||
                sceneBusy ||
                current?.version !== preview.source.sceneVersion
              }
              onClick={async () => {
                if (!issueKey || !canPrepareQuote || current?.version !== preview.source.sceneVersion) return;
                setBusy(true);
                setError('');
                try {
                  const issued = await accountRequest<IssuedQuotation>(
                    `/api/projects/${projectId}/quotations`,
                    {
                      method: 'POST',
                      body: {
                        expectedSceneVersion: preview.source.sceneVersion,
                        expectedPolicyRevision: preview.source.policyRevision,
                        expectedSourceFingerprint: preview.sourceFingerprint,
                        idempotencyKey: issueKey,
                        ...(preview.photo ? { photo: preview.photo } : {}),
                      },
                    },
                  );
                  setQuotes((previous) => [issued, ...previous.filter((item) => item.id !== issued.id)]);
                  setSelected(issued.id);
                  setPreview(null);
                  setIssueKey(null);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Could not issue quotation.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Issue reviewed quotation
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setIssueKey(null);
              }}
            >
              Discard quotation preview
            </Button>
          </div>
        )}
      {loaded && quotes.length === 0 && (
        <p className="account-muted">No issued quotations for this project.</p>
      )}
      <div className="business-card-list">
        {quotes.map((quote) => (
          <article className="business-record" key={quote.id}>
            <div>
              <strong>{quote.number}</strong>
              <p>
                Design revision {quote.sceneVersion} · {new Date(quote.issuedAt).toLocaleString()}
              </p>
              <strong>
                {formatMoney(
                  quote.snapshot.calculation.totals.grandTotalMinor,
                  quote.snapshot.source.project.currency,
                )}
              </strong>
            </div>
            <Button onClick={() => setSelected(selected === quote.id ? null : quote.id)}>
              {selected === quote.id ? 'Hide quotation details' : 'View quotation details'}
            </Button>
            <a
              className="business-text-link"
              href={`/api/projects/${projectId}/quotations/${quote.id}/pdf`}
              download
            >
              Download quotation PDF
            </a>
          </article>
        ))}
      </div>
      {chosen && (
        <div role="region" aria-label="Issued quotation details">
          <h3>{chosen.number}</h3>
          <QuoteAmounts calculation={chosen.snapshot.calculation} />
          {chosen.snapshot.photo && (
            <>
              <img
                className="photo-final-preview"
                alt="Photograph confirmed with this quotation"
                src={`/api/projects/${projectId}/references/${chosen.snapshot.photo.renderedReferenceId}`}
              />
              <p>
                Confirmed photograph revision {chosen.snapshot.photo.compositionRevision} · original catalogue
                images and SKU associations are retained in this quotation.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
