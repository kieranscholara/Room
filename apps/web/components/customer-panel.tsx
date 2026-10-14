'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { accountRequest, type WorkspaceContext } from './workspace-frame';
import type { CustomerRecord } from './workspace-business-types';

const blank = { name: '', email: '', phone: '', notes: '' };
export function CustomerPanel({ context }: { context: WorkspaceContext }) {
  const base = `/api/organisations/${context.organisation.id}/customers`;
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCustomers(await accountRequest<CustomerRecord[]>(base));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  if (context.organisation.role === 'customer')
    return <p className="account-muted">Customer records are available to your retailer team.</p>;
  return (
    <section className="account-panel" aria-label="Customer records">
      <div>
        <h1>Customers</h1>
        <p className="account-muted">
          Customer contact records and showroom notes for {context.organisation.name}.
        </p>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
          <Button onClick={() => void load()}>Reload customers</Button>
        </p>
      )}
      {message && (
        <p role="status" className="account-notice">
          {message}
        </p>
      )}
      <form
        className="business-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setMessage('');
          try {
            await accountRequest(`${base}${editId ? `?id=${editId}` : ''}`, {
              method: editId ? 'PATCH' : 'POST',
              body: form,
            });
            setMessage(editId ? 'Customer updated.' : 'Customer created.');
            setEditId(null);
            setForm(blank);
            await load();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not save this customer.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>{editId ? 'Edit customer' : 'New customer'}</h2>
        <div className="business-form-grid">
          <Field label="Customer name">
            <input
              aria-label="Customer name"
              required
              maxLength={100}
              value={form.name}
              disabled={busy}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Customer email">
            <input
              aria-label="Customer email"
              type="email"
              maxLength={254}
              value={form.email}
              disabled={busy}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="Customer phone">
            <input
              aria-label="Customer phone"
              type="tel"
              maxLength={50}
              value={form.phone}
              disabled={busy}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
            />
          </Field>
          <Field label="Customer notes">
            <textarea
              aria-label="Customer notes"
              maxLength={5000}
              rows={3}
              value={form.notes}
              disabled={busy}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
        </div>
        <div className="business-actions">
          <Button type="submit" variant="primary" disabled={busy || loading}>
            {busy ? 'Saving…' : editId ? 'Save customer' : 'Create customer'}
          </Button>
          {editId && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditId(null);
                setForm(blank);
              }}
            >
              Cancel edit
            </Button>
          )}
        </div>
      </form>
      <Field label="Search customers">
        <input
          aria-label="Search customers"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      {loading ? (
        <p role="status">Loading customers…</p>
      ) : (
        <div className="business-card-list">
          {customers
            .filter((customer) =>
              `${customer.name} ${customer.email || ''} ${customer.phone || ''}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((customer) => (
              <article className="business-record" key={customer.id}>
                <div>
                  <h3>{customer.name}</h3>
                  <p className="account-muted">
                    {[customer.email, customer.phone].filter(Boolean).join(' · ') || 'No contact details'}
                  </p>
                  {customer.notes && <p className="business-notes">{customer.notes}</p>}
                </div>
                <div className="business-actions">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditId(customer.id);
                      setForm({
                        name: customer.name,
                        email: customer.email || '',
                        phone: customer.phone || '',
                        notes: customer.notes,
                      });
                    }}
                  >
                    Edit {customer.name}
                  </Button>
                  {context.canManage &&
                    (removeId === customer.id ? (
                      <div className="business-confirm">
                        <p>Remove this customer record? Records linked to projects must be retained.</p>
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            try {
                              await accountRequest(`${base}?id=${customer.id}`, { method: 'DELETE' });
                              setRemoveId(null);
                              if (editId === customer.id) {
                                setEditId(null);
                                setForm(blank);
                              }
                              setMessage('Customer removed.');
                              await load();
                            } catch (reason) {
                              setError(
                                reason instanceof Error ? reason.message : 'Could not remove the customer.',
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Confirm removal
                        </Button>
                        <Button onClick={() => setRemoveId(null)} disabled={busy}>
                          Keep customer
                        </Button>
                      </div>
                    ) : (
                      <Button variant="danger" onClick={() => setRemoveId(customer.id)} disabled={busy}>
                        Remove {customer.name}
                      </Button>
                    ))}
                </div>
              </article>
            ))}
          {!customers.length && (
            <p className="account-empty">
              Create a customer record to connect it to a measured project. Account access is granted
              separately from the project.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
