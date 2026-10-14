'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { accountRequest } from './workspace-frame';
import { formatMoney, parseMoney } from './workspace-business-types';
import type { PublicOffer } from '../lib/marketplace-service';
import './workspace-business.css';
interface PersonalProject {
  id: string;
  name: string;
  budgetMinor: number;
  currency: string;
  version: number;
}
export function Marketplace() {
  const [offers, setOffers] = useState<PublicOffer[]>([]),
    [projects, setProjects] = useState<PersonalProject[]>([]),
    [signedIn, setSignedIn] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [projectId, setProjectId] = useState(''),
    [name, setName] = useState(''),
    [currency, setCurrency] = useState('EUR'),
    [budget, setBudget] = useState(''),
    [width, setWidth] = useState(''),
    [depth, setDepth] = useState(''),
    [height, setHeight] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    try {
      setOffers(await accountRequest<PublicOffer[]>(`/api/marketplace/offers?offset=${offset}`));
      const session = await fetch('/api/auth/session', { cache: 'no-store' });
      setSignedIn(session.ok);
      if (session.ok) setProjects(await accountRequest<PersonalProject[]>('/api/consumer/projects'));
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Marketplace unavailable.');
    }
  }, [offset]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main className="business-main">
      <section className="account-panel">
        <div>
          <p className="account-role">ROOMSELL MARKETPLACE</p>
          <h1>Furniture for your measured room</h1>
          <p className="account-muted">
            Browse explicitly published retailer products. Save a private personal design, then choose which
            retailer receives a quotation enquiry.
          </p>
        </div>
        <div className="business-form-row">
          <Link href="/workspace">Retailer workspace</Link>
          {!signedIn && (
            <>
              <Link href="/auth/login?next=%2Fmarketplace">Sign in to save a design</Link>
              <Link href="/auth/signup?next=%2Fmarketplace">Create an account</Link>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        {signedIn && (
          <>
            <h2>Your private designs</h2>
            <div className="business-card-list">
              {projects.map((project) => (
                <article className="business-record" key={project.id}>
                  <div>
                    <strong>{project.name}</strong>
                    <p>
                      {formatMoney(project.budgetMinor, project.currency)} budget · revision {project.version}
                    </p>
                  </div>
                  <Link className="business-text-link" href={`/designs/${project.id}`}>
                    Open personal design
                  </Link>
                </article>
              ))}
            </div>
            <details>
              <summary>Create a measured personal room</summary>
              <form
                className="business-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!confirmed) return;
                  setBusy(true);
                  setError('');
                  try {
                    const project = await accountRequest<PersonalProject>('/api/consumer/projects', {
                      method: 'POST',
                      body: {
                        name,
                        currency,
                        budgetMinor: parseMoney(budget, currency),
                        room: {
                          name,
                          width: Number(width),
                          depth: Number(depth),
                          height: Number(height),
                          measurementsConfirmed: confirmed,
                          openings: [],
                          zones: [],
                        },
                      },
                    });
                    setProjects((previous) => [project, ...previous]);
                    setProjectId(project.id);
                    setName('');
                    setConfirmed(false);
                  } catch (reason) {
                    setError(
                      reason instanceof Error ? reason.message : 'Personal room could not be created.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label="Personal design name">
                  <input
                    aria-label="Personal design name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field label="Personal design currency">
                  <select
                    aria-label="Personal design currency"
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                  >
                    {['EUR', 'GBP', 'USD', 'JPY', 'KWD'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Personal design budget">
                  <input
                    aria-label="Personal design budget"
                    required
                    inputMode="decimal"
                    value={budget}
                    onChange={(event) => setBudget(event.target.value)}
                  />
                </Field>
                <div className="business-form-row">
                  {[
                    ['width', width, setWidth],
                    ['depth', depth, setDepth],
                    ['height', height, setHeight],
                  ].map(([label, value, setter]) => (
                    <Field key={String(label)} label={`Personal room ${label} (m)`}>
                      <input
                        aria-label={`Personal room ${label} (m)`}
                        type="number"
                        min="2"
                        max={label === 'height' ? 6 : 30}
                        step="0.01"
                        required
                        value={value as string}
                        onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                      />
                    </Field>
                  ))}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />{' '}
                  I confirm these personal room dimensions were measured.
                </label>
                <Button type="submit" disabled={!confirmed || busy}>
                  Create personal design
                </Button>
              </form>
            </details>
            <Field label="Design to furnish">
              <select
                aria-label="Design to furnish"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Choose your personal design</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </section>
      <section className="account-panel" aria-label="Published furniture">
        <h2>Published furniture</h2>
        <p className="account-muted">
          Shown prices include the retailer’s configured product tax. Delivery, installation and any quotation
          discounts are confirmed by each retailer.
        </p>
        {loaded && !offers.length && <p>No published furniture on this page.</p>}
        <div className="business-card-list">
          {offers.map((offer) => (
            <article className="business-record" key={offer.id}>
              {offer.images[0] && (
                <img className="business-item-image" src={offer.images[0].url} alt={offer.name} />
              )}
              <div>
                <strong>
                  {offer.name} — {offer.variantName}
                </strong>
                <p>
                  {offer.retailer}
                  {offer.fictional ? ' · FICTIONAL TEST PRODUCT' : ''}
                </p>
                <p>
                  {offer.sku} · {offer.dimensions.width} × {offer.dimensions.depth} ×{' '}
                  {offer.dimensions.height} m
                </p>
                <strong>{formatMoney(offer.priceMinor, offer.currency)}</strong>
                <p>{offer.available ? offer.availability.replaceAll('_', ' ') : 'Currently unavailable'}</p>
              </div>
              {projectId && offer.available && (
                <Link className="business-text-link" href={`/designs/${projectId}?offer=${offer.id}`}>
                  Place in your design
                </Link>
              )}
            </article>
          ))}
        </div>
        <div className="business-form-row">
          <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Previous published page
          </Button>
          <Button disabled={offers.length < 50} onClick={() => setOffset(offset + 50)}>
            Next published page
          </Button>
        </div>
      </section>
    </main>
  );
}
