'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@roomsell/ui';
import { accountRequest } from './workspace-frame';
import './workspace-business.css';
export function TestingCustomer() {
  const router = useRouter(),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void accountRequest('/api/testing/status')
      .then(() => setReady(true))
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
