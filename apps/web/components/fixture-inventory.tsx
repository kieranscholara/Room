'use client';
import { useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { accountRequest } from './workspace-frame';
interface Item {
  externalVariantId: string;
  sku: string;
  stockQuantity: number;
  availability: 'in_stock' | 'made_to_order' | 'out_of_stock';
}
export function FixtureInventory({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<Item[]>([]),
    [id, setId] = useState(''),
    [quantity, setQuantity] = useState('0'),
    [availability, setAvailability] = useState<Item['availability']>('in_stock'),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch('/api/testing/status', { cache: 'no-store' });
      if (!response.ok) return;
      const status = await response.json();
      if (status.organisationId !== orgId) return;
      const stock = await accountRequest<{ items: Item[] }>('/api/testing/inventory');
      if (active) setItems(stock.items);
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [orgId]);
  if (!items.length) return null;
  return (
    <section className="account-panel" aria-label="Fictional upstream inventory">
      <h2>Boreal Living simulated inventory</h2>
      <p className="account-notice">
        Fictional test provider. Change upstream quantities here, then use Synchronise inventory now on the
        connection below. No external retailer service is contacted.
      </p>
      <form
        className="business-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await accountRequest('/api/testing/inventory', {
              method: 'POST',
              body: { externalVariantId: id, stockQuantity: Number(quantity), availability },
            });
            setMessage('Simulated provider stock updated. Synchronise the inventory connection to apply it.');
          } catch (reason) {
            setMessage(reason instanceof Error ? reason.message : 'Test stock update failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Test stock SKU">
          <select
            aria-label="Test stock SKU"
            value={id}
            required
            onChange={(event) => {
              const item = items.find((row) => row.externalVariantId === event.target.value);
              setId(event.target.value);
              if (item) {
                setQuantity(String(item.stockQuantity));
                setAvailability(item.availability);
              }
            }}
          >
            <option value="">Choose a fictional SKU</option>
            {items.map((item) => (
              <option value={item.externalVariantId} key={item.externalVariantId}>
                {item.sku}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Test upstream quantity">
          <input
            aria-label="Test upstream quantity"
            type="number"
            min="0"
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <Field label="Test upstream availability">
          <select
            aria-label="Test upstream availability"
            value={availability}
            onChange={(event) => setAvailability(event.target.value as Item['availability'])}
          >
            <option value="in_stock">In stock</option>
            <option value="made_to_order">Made to order</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
        </Field>
        <Button type="submit" disabled={!id || busy}>
          Update simulated provider stock
        </Button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
