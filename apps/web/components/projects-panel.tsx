'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { accountRequest, type WorkspaceContext } from './workspace-frame';
import { formatMoney, parseMoney, type CustomerRecord, type ProjectRecord } from './workspace-business-types';

export function ProjectsPanel({ context }: { context: WorkspaceContext }) {
  const { organisation } = context;
  const base = `/api/organisations/${organisation.id}`;
  const staff = organisation.role !== 'customer';
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [form, setForm] = useState({
    name: '',
    customerId: '',
    budget: '',
    currency: organisation.currency,
    style: '',
    roomType: 'bedroom',
    roomName: '',
    width: '',
    depth: '',
    height: '',
    measurementsConfirmed: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<ProjectRecord | null>(null);
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [records, people] = await Promise.all([
        accountRequest<ProjectRecord[]>(`${base}/projects`),
        staff ? accountRequest<CustomerRecord[]>(`${base}/customers`) : Promise.resolve([]),
      ]);
      setProjects(records);
      setCustomers(people);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load projects.');
    } finally {
      setLoading(false);
    }
  }, [base, staff]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="account-panel" aria-label="Projects">
      <div>
        <h1>Projects</h1>
        <p className="account-muted">
          {staff
            ? 'Customer designs built from confirmed room measurements and your catalogue.'
            : 'Designs your retailer has shared with your account.'}
        </p>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
          <Button onClick={() => void load()}>Reload projects</Button>
        </p>
      )}
      {created && (
        <div className="account-notice" role="status">
          Project created.{' '}
          <Link className="business-text-link" href={`/projects/${created.id}`}>
            Open {created.name}
          </Link>
        </div>
      )}
      {staff && (
        <details className="account-details" open={!projects.length}>
          <summary>New measured project</summary>
          <form
            className="business-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              setCreated(null);
              try {
                const project = await accountRequest<ProjectRecord>(`${base}/projects`, {
                  method: 'POST',
                  body: {
                    name: form.name,
                    customerId: form.customerId || null,
                    budgetMinor: parseMoney(form.budget, form.currency),
                    currency: form.currency,
                    style: form.style,
                    roomType: form.roomType,
                    room: {
                      name: form.roomName,
                      width: Number(form.width),
                      depth: Number(form.depth),
                      height: Number(form.height),
                      measurementsConfirmed: form.measurementsConfirmed,
                      zones: [],
                      openings: [],
                    },
                  },
                });
                setCreated(project);
                setForm({
                  name: '',
                  customerId: '',
                  budget: '',
                  currency: organisation.currency,
                  style: '',
                  roomType: 'bedroom',
                  roomName: '',
                  width: '',
                  depth: '',
                  height: '',
                  measurementsConfirmed: false,
                });
                await load();
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Could not create your project.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="business-form-grid">
              <Field label="Project name">
                <input
                  aria-label="Project name"
                  required
                  maxLength={100}
                  value={form.name}
                  disabled={busy}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <Field label="Project customer">
                <select
                  aria-label="Project customer"
                  value={form.customerId}
                  disabled={busy}
                  onChange={(event) => setForm({ ...form, customerId: event.target.value })}
                >
                  <option value="">No customer record</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Project budget">
                <input
                  aria-label="Project budget"
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]+)?"
                  value={form.budget}
                  disabled={busy}
                  onChange={(event) => setForm({ ...form, budget: event.target.value })}
                />
              </Field>
              <Field label="Project currency">
                <input
                  aria-label="Project currency"
                  required
                  pattern="[A-Z]{3}"
                  maxLength={3}
                  value={form.currency}
                  disabled={busy}
                  onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Project style">
                <input
                  aria-label="Project style"
                  maxLength={100}
                  value={form.style}
                  disabled={busy}
                  onChange={(event) => setForm({ ...form, style: event.target.value })}
                />
              </Field>
              <Field label="Room type">
                <select
                  aria-label="Room type"
                  value={form.roomType}
                  disabled={busy}
                  onChange={(event) => setForm({ ...form, roomType: event.target.value })}
                >
                  <option value="bedroom">Bedroom</option>
                  <option value="living_room">Living room</option>
                  <option value="office">Office</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Room name">
                <input
                  aria-label="Room name"
                  required
                  maxLength={100}
                  value={form.roomName}
                  disabled={busy}
                  onChange={(event) => setForm({ ...form, roomName: event.target.value })}
                />
              </Field>
              {(['width', 'depth', 'height'] as const).map((dimension) => (
                <Field key={dimension} label={`Measured room ${dimension} (m)`}>
                  <input
                    aria-label={`Measured room ${dimension} (m)`}
                    required
                    type="number"
                    min={2}
                    max={dimension === 'height' ? 6 : 30}
                    step="0.01"
                    value={form[dimension]}
                    disabled={busy}
                    onChange={(event) => setForm({ ...form, [dimension]: event.target.value })}
                  />
                </Field>
              ))}
            </div>
            <label className="business-checkbox">
              <input
                type="checkbox"
                required
                checked={form.measurementsConfirmed}
                disabled={busy}
                onChange={(event) => setForm({ ...form, measurementsConfirmed: event.target.checked })}
              />
              I confirm these room dimensions were measured.
            </label>
            <p className="account-muted">
              Dimensions use metres. Add doors, windows, obstacles and circulation areas in the editor before
              placing furniture.
            </p>
            <Button variant="primary" type="submit" disabled={busy || loading}>
              {busy ? 'Creating…' : 'Create measured project'}
            </Button>
          </form>
        </details>
      )}
      <Field label="Search projects">
        <input
          aria-label="Search projects"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      {loading ? (
        <p role="status">Loading projects…</p>
      ) : (
        <div className="business-card-list">
          {projects
            .filter((project) =>
              `${project.name} ${project.style}`.toLowerCase().includes(query.toLowerCase()),
            )
            .map((project) => (
              <article className="business-record" key={project.id}>
                <div>
                  <h2>{project.name}</h2>
                  <p className="account-muted">
                    {project.roomType.replace('_', ' ')}
                    {project.style ? ` · ${project.style}` : ''} · Budget{' '}
                    {formatMoney(project.budgetMinor, project.currency)}
                  </p>
                  {project.customerId && (
                    <p className="account-muted">
                      Customer:{' '}
                      {customers.find((customer) => customer.id === project.customerId)?.name ||
                        'Assigned customer'}
                    </p>
                  )}
                </div>
                <Link className="button button-primary" href={`/projects/${project.id}`}>
                  Open project
                </Link>
              </article>
            ))}
          {!projects.length && (
            <p className="account-empty">
              {staff
                ? 'Create a project from actual room measurements to start a design.'
                : 'No projects have been shared with your account yet.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
