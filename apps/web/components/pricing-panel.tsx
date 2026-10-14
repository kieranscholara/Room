'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { pricingPolicySchema, type PricingPolicy } from '@roomsell/pricing';
import { accountRequest, type WorkspaceContext } from './workspace-frame';

export interface PricingConfiguration {
  revision: number;
  policy: PricingPolicy;
}
const requiredMessage =
  'Enter every commercial rule explicitly before saving. Tax rates must be supplied by the retailer.';
export function PricingPanel({ context }: { context: WorkspaceContext }) {
  const endpoint = `/api/organisations/${context.organisation.id}/pricing`;
  const [current, setCurrent] = useState<PricingConfiguration | null>(null);
  const [draft, setDraft] = useState<Partial<PricingPolicy>>({
    version: 1,
    currency: context.organisation.currency,
  });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const data = await accountRequest<PricingConfiguration | null>(endpoint);
      setCurrent(data);
      setDraft(data?.policy ?? { version: 1, currency: context.organisation.currency });
      setLoaded(true);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load pricing rules.');
    }
  }, [endpoint, context.organisation.currency]);
  useEffect(() => {
    void load();
  }, [load]);
  function numberField(
    key: 'taxRateBps' | 'discountBps' | 'deliveryMinor' | 'installationMinor',
    label: string,
    max: number,
  ) {
    return (
      <Field label={label}>
        <input
          aria-label={label}
          type="number"
          min="0"
          max={max}
          step="1"
          required
          disabled={busy}
          value={draft[key] ?? ''}
          onChange={(event) =>
            setDraft({ ...draft, [key]: event.target.value === '' ? undefined : Number(event.target.value) })
          }
        />
      </Field>
    );
  }
  return (
    <section className="account-panel" aria-label="Quotation pricing rules">
      <div>
        <h1>Quotation pricing</h1>
        <p className="account-muted">
          Set the rules used to price new quotations. Issued quotations retain their original rules and
          amounts.
        </p>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!loaded ? (
        <Button onClick={() => void load()}>Load pricing rules</Button>
      ) : (
        <form
          className="business-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            setMessage('');
            const parsed = pricingPolicySchema.safeParse(draft);
            if (!parsed.success) {
              setError(requiredMessage);
              return;
            }
            setBusy(true);
            try {
              const saved = await accountRequest<PricingConfiguration>(endpoint, {
                method: 'PUT',
                body: { expectedRevision: current?.revision ?? 0, policy: parsed.data },
              });
              setCurrent(saved);
              setDraft(saved.policy);
              setMessage(`Pricing rules saved · revision ${saved.revision}`);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not save pricing rules.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Quotation currency">
            <input aria-label="Quotation currency" required readOnly value={draft.currency ?? ''} />
          </Field>
          <Field label="Listed prices include tax">
            <select
              aria-label="Listed prices include tax"
              required
              value={draft.taxMode ?? ''}
              disabled={busy}
              onChange={(event) =>
                setDraft({ ...draft, taxMode: event.target.value as PricingPolicy['taxMode'] })
              }
            >
              <option value="">Choose tax treatment</option>
              <option value="exclusive">No — tax is added</option>
              <option value="inclusive">Yes — tax is included</option>
            </select>
          </Field>
          {numberField('taxRateBps', 'Tax rate (basis points)', 10000)}
          <p className="account-muted">100 basis points = 1%. Enter 0 for a zero tax rate.</p>
          <Field label="Quotation rounding">
            <select
              aria-label="Quotation rounding"
              required
              value={draft.rounding ?? ''}
              disabled={busy}
              onChange={(event) =>
                setDraft({ ...draft, rounding: event.target.value as PricingPolicy['rounding'] })
              }
            >
              <option value="">Choose rounding</option>
              <option value="per_line">Round each line</option>
              <option value="invoice">Round invoice totals</option>
            </select>
          </Field>
          {numberField('discountBps', 'Furniture discount (basis points)', 10000)}
          {numberField('deliveryMinor', 'Delivery fee (minor currency units)', Number.MAX_SAFE_INTEGER)}
          {numberField(
            'installationMinor',
            'Installation fee (minor currency units)',
            Number.MAX_SAFE_INTEGER,
          )}
          <Field label="Fees subject to tax">
            <select
              aria-label="Fees subject to tax"
              required
              value={draft.feesTaxable === undefined ? '' : String(draft.feesTaxable)}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, feesTaxable: event.target.value === 'true' })}
            >
              <option value="">Choose fee treatment</option>
              <option value="true">Tax applies to both fees</option>
              <option value="false">Fees have no tax</option>
            </select>
          </Field>
          <p className="account-muted">
            Fees use the same tax inclusion rule as listed furniture prices. Discounts apply to furniture
            only. Enter 0 for fees or discounts you do not charge.
          </p>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving rules…' : 'Save pricing rules'}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void load()}>
            Reload saved rules
          </Button>
        </form>
      )}
    </section>
  );
}
