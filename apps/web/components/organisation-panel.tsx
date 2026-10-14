'use client';
import { useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { Button, Field } from '@roomsell/ui';
import { accountRequest, type Organisation } from './workspace-frame';

export function OrganisationPanel({
  organisation,
  onCreated,
}: {
  organisation: Organisation | null;
  onCreated(organisation: Organisation): Promise<void>;
}) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="account-panel" aria-label="Organisation settings">
      <div className="account-panel-heading">
        <Building2 size={22} />
        <div>
          <h2>{organisation ? organisation.name : 'Create your first organisation'}</h2>
          <p className="account-muted">
            {organisation
              ? `${organisation.currency} · Your role: ${organisation.role}`
              : 'Keep your team, customers and furniture catalogue together.'}
          </p>
        </div>
      </div>
      {organisation && (
        <div className="account-empty">
          <h3>Your workspace is ready</h3>
          <p>
            Invite your colleagues from Team. Your organisation contains only the data your team creates or
            imports.
          </p>
        </div>
      )}
      <details className="account-details" open={!organisation}>
        <summary>
          <Plus size={16} /> {organisation ? 'Create another organisation' : 'Organisation details'}
        </summary>
        <form
          className="account-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              const created = await accountRequest<Organisation>('/api/organisations', {
                method: 'POST',
                body: { name: name.trim(), currency },
              });
              await onCreated(created);
              setName('');
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not create the organisation.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Organisation name">
            <input
              aria-label="Organisation name"
              value={name}
              required
              minLength={2}
              maxLength={100}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your retailer or design studio"
            />
          </Field>
          <Field label="Organisation currency">
            <select
              aria-label="Organisation currency"
              value={currency}
              disabled={busy}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British pound</option>
              <option value="USD">USD — US dollar</option>
              <option value="CAD">CAD — Canadian dollar</option>
              <option value="AUD">AUD — Australian dollar</option>
            </select>
          </Field>
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="primary" type="submit" disabled={busy}>
            <Plus size={16} />
            {busy ? 'Creating…' : 'Create organisation'}
          </Button>
        </form>
      </details>
    </section>
  );
}
