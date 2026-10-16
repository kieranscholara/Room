'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@roomsell/ui';
import { accountRequest } from './workspace-frame';
import { formatMoney } from './workspace-business-types';
import type { IssuedQuotation, QuotationSnapshot } from '../lib/quotation-schemas';
interface Order {
  id: string;
  quotationId: string;
  canManage: boolean;
  status: string;
  expiresAt: string;
  snapshot: QuotationSnapshot;
  createdAt: string;
  supplierPending: boolean;
  supplierAcknowledgement: { supplierReference: string; status: 'accepted' | 'rejected' } | null;
}
interface Orders {
  canOrder: boolean;
  canFulfil: boolean;
  orders: Order[];
}
export function ProjectOrders({ projectId }: { projectId: string }) {
  const [state, setState] = useState<Orders | null>(null),
    [quotes, setQuotes] = useState<IssuedQuotation[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const path = `/api/projects/${projectId}/orders`;
  const load = useCallback(async () => {
    try {
      const [data, issued] = await Promise.all([
        accountRequest<Orders>(path),
        accountRequest<IssuedQuotation[]>(`/api/projects/${projectId}/quotations`),
      ]);
      setState(data);
      setQuotes(issued);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load orders.');
    }
  }, [path, projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function transition(order: Order, action: 'confirm' | 'cancel' | 'fulfil') {
    setBusy(true);
    try {
      await accountRequest(`${path}/${order.id}`, {
        method: 'POST',
        body: { action, expectedStatus: order.status },
      });
      await load();
    } catch (reason) {
      await load();
      setError(reason instanceof Error ? reason.message : 'Order update failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-panel" aria-label="Project orders">
      <div>
        <h2>Orders and stock reservations</h2>
        <p className="account-muted">
          An issued quotation can be reserved for 15 minutes. Confirmed orders keep stock held until
          cancellation or fulfilment. These actions record an order; no payment is collected.
        </p>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <Button disabled={busy} onClick={() => void load()}>
        Refresh orders and issued quotations
      </Button>
      {state && !state.canOrder && (
        <p className="account-muted">
          Ordering requires explicit permission from the retailer for this project.
        </p>
      )}
      {state?.canOrder &&
        quotes
          .filter(
            (quote) =>
              !state.orders.some(
                (order) =>
                  order.quotationId === quote.id &&
                  ['reserved', 'confirmed', 'fulfilled'].includes(order.status),
              ),
          )
          .map((quote) => (
            <article className="business-record" key={quote.id}>
              <div>
                <strong>{quote.number}</strong>
                <p>
                  {formatMoney(
                    quote.snapshot.calculation.totals.grandTotalMinor,
                    quote.snapshot.source.project.currency,
                  )}
                </p>
              </div>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await accountRequest(path, {
                      method: 'POST',
                      body: { quotationId: quote.id, idempotencyKey: crypto.randomUUID() },
                    });
                    await load();
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : 'Stock could not be reserved.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reserve quotation stock
              </Button>
            </article>
          ))}
      <div className="business-card-list">
        {state?.orders.map((order) => (
          <article className="business-record" key={order.id}>
            <div>
              <strong>Order {order.id.slice(0, 8)}</strong>
              <p>
                {order.status} ·{' '}
                {formatMoney(
                  order.snapshot.calculation.totals.grandTotalMinor,
                  order.snapshot.source.project.currency,
                )}
              </p>
              {order.status === 'reserved' && (
                <p>Reservation expires {new Date(order.expiresAt).toLocaleString()}</p>
              )}
              {order.supplierPending && (
                <p role="status">
                  Supplier acknowledgement pending. Retry fulfilment to recover the same supplier order.
                </p>
              )}
              {order.supplierAcknowledgement && (
                <p>
                  Supplier {order.supplierAcknowledgement.status}:{' '}
                  {order.supplierAcknowledgement.supplierReference}
                </p>
              )}
            </div>
            {order.canManage && order.status === 'reserved' && (
              <Button disabled={busy} onClick={() => void transition(order, 'confirm')}>
                Confirm order
              </Button>
            )}
            {order.canManage &&
              !order.supplierPending &&
              ['reserved', 'confirmed'].includes(order.status) && (
                <Button disabled={busy} onClick={() => void transition(order, 'cancel')}>
                  Cancel order
                </Button>
              )}
            {state.canFulfil &&
              order.status === 'confirmed' &&
              order.supplierAcknowledgement?.status !== 'rejected' && (
                <Button disabled={busy} onClick={() => void transition(order, 'fulfil')}>
                  Record fulfilment
                </Button>
              )}
          </article>
        ))}
      </div>
    </section>
  );
}
