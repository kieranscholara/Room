'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@roomsell/ui';
import { accountRequest } from './workspace-frame';
import './workspace-business.css';
export function TestingCustomer() {
  const router = useRouter(),
    [ready, setReady] = useState(false),
    [projectId, setProjectId] = useState(''),
    [replacementProjectId, setReplacementProjectId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void accountRequest<{ projectId: string; replacementProjectId?: string }>('/api/testing/status')
      .then((value) => {
        setReady(true);
        setProjectId(value.projectId);
        setReplacementProjectId(value.replacementProjectId ?? '');
      })
      .catch((reason) => setError(reason.message));
  }, []);
  return (
    <main className="business-main">
      <section className="account-panel">
        <p className="account-role">FICTIONAL CUSTOMER TEST ENVIRONMENT</p>
        <h1>Boreal Living</h1>
        <p>
          A fictional Scandinavian furniture retailer with showroom staff, a measured customer bedroom,
          catalogue photographs and simulated inventory. These are synthetic records for testing, not real
          customer or retailer data.
        </p>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <p>
          Start with a furnished photograph. Select the original bed, review its removal, choose the store’s
          Linen bed and save the edited photograph for quotation. The supplied trial uses recorded image edits
          and assumed fictional measurements.
        </p>
        <Button
          variant="primary"
          disabled={!ready || busy || !replacementProjectId}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await accountRequest('/api/testing/session', { method: 'POST', body: { persona: 'retailer' } });
              router.push(`/projects/${replacementProjectId}?photo=replacement`);
              router.refresh();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not open photographic trial.');
              setBusy(false);
            }
          }}
        >
          Open photograph replacement trial
        </Button>
        <p>
          Try placing dimensioned furniture into a calibrated synthetic room image. The separate room
          photograph is available for your own calibration; the synthetic example has known measurements and a
          recorded removal adapter.
        </p>
        <Button
          disabled={!ready || busy}
          variant="primary"
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await accountRequest('/api/testing/session', { method: 'POST', body: { persona: 'retailer' } });
              router.push(`/projects/${projectId}?view=photo&photo=synthetic`);
              router.refresh();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not open photo demo.');
              setBusy(false);
            }
          }}
        >
          Open photo placement demo
        </Button>
        <div className="business-card-list">
          {(['retailer', 'customer', 'consumer'] as const).map((persona) => (
            <article className="business-record" key={persona}>
              <div>
                <h2>
                  {persona === 'retailer'
                    ? 'Showroom manager'
                    : persona === 'customer'
                      ? 'Shared project customer'
                      : 'Marketplace consumer'}
                </h2>
                <p>
                  {persona === 'retailer'
                    ? 'Manage products, inventory, designs, quotations and orders.'
                    : persona === 'customer'
                      ? 'Review the shared design, room photographs and issued quotations.'
                      : 'Browse published furniture and save a private personal design.'}
                </p>
              </div>
              <Button
                disabled={!ready || busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const result = await accountRequest<{ redirect: string }>('/api/testing/session', {
                      method: 'POST',
                      body: { persona },
                    });
                    router.push(result.redirect);
                    router.refresh();
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : 'Could not sign in.');
                    setBusy(false);
                  }
                }}
              >
                Enter as {persona}
              </Button>
            </article>
          ))}
        </div>
        <p className="account-muted">
          Local-only shortcut accounts use generated credentials stored in ignored restricted files. Ordinary
          users and private organisations remain isolated.
        </p>
      </section>
    </main>
  );
}
