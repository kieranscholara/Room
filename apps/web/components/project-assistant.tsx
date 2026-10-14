'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import type { Proposal } from '@roomsell/scene-core';
import type { QuotationPricing } from '@roomsell/pricing';
import type { AssistantCandidate } from '../lib/assistant-contract';
import { useEditor } from '../lib/editor-store';
import { accountRequest } from './workspace-frame';
import { formatMoney } from './workspace-business-types';
interface Result {
  provider: 'openai' | 'test';
  fictionalAdapter: boolean;
  summary: string;
  baseVersion: number;
  recommendations: (AssistantCandidate & { quantity: number })[];
  calculation: QuotationPricing;
  overBudget: boolean;
  proposal: Proposal | null;
}
interface Job {
  id: string;
  kind?: string;
  status: string;
  errorCode: string | null;
  result: Result | null;
}
export function ProjectAssistant({
  projectId,
  canEdit,
  staff,
}: {
  projectId: string;
  canEdit: boolean;
  staff: boolean;
}) {
  const { scene, endpoint, proposal, busy, preview, reviewProposal } = useEditor(),
    current = endpoint === `/api/projects/${projectId}/scene` ? scene : null;
  const [status, setStatus] = useState<{ openAiConfigured: boolean; testAdapterEnabled: boolean } | null>(
      null,
    ),
    [provider, setProvider] = useState<'openai' | 'test'>('openai'),
    [brief, setBrief] = useState('Make the room feel open while keeping locked furniture in place.'),
    [usePhotos, setUsePhotos] = useState(false),
    [references, setReferences] = useState<{ id: string; name: string }[]>([]),
    [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(''),
    [submitting, setSubmitting] = useState(false),
    [x, setX] = useState(''),
    [z, setZ] = useState('');
  const load = useCallback(async () => {
    try {
      const [info, photos, jobs] = await Promise.all([
        accountRequest<{ openAiConfigured: boolean; testAdapterEnabled: boolean }>(
          `/api/projects/${projectId}/assistant`,
        ),
        accountRequest<{ id: string; name: string }[]>(`/api/projects/${projectId}/references`),
        accountRequest<Job[]>(`/api/projects/${projectId}/jobs`),
      ]);
      setJob(jobs.find((item) => item.kind === 'ai_design') ?? null);
      setStatus(info);
      setReferences(photos);
      if (!info.openAiConfigured && info.testAdapterEnabled) setProvider('test');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Assistant status unavailable.');
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await accountRequest<Job>(`/api/jobs/${job.id}`, { signal: controller.signal });
        if (cancelled) return;
        setJob(next);
        if (['queued', 'running'].includes(next.status)) timer = setTimeout(() => void poll(), 1500);
      } catch (reason) {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not check assistance progress.');
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [job?.id, job?.status]);
  const result = job?.status === 'completed' ? job.result : null;
  return (
    <section className="account-panel" aria-label="Design assistant">
      <div>
        <h2>Design assistant</h2>
        <p className="account-muted">
          Suggestions use verified catalogue products and configured prices. Every layout goes through the
          existing geometry, locking and preview rules before you accept it.
        </p>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {canEdit && (
        <form
          className="business-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!current) return;
            setSubmitting(true);
            setError('');
            try {
              setJob(
                await accountRequest<Job>(`/api/projects/${projectId}/assistant`, {
                  method: 'POST',
                  body: {
                    brief,
                    expectedSceneVersion: current.version,
                    provider,
                    referenceIds:
                      provider === 'openai' && usePhotos ? references.slice(0, 2).map((item) => item.id) : [],
                    idempotencyKey: crypto.randomUUID(),
                  },
                }),
              );
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not request assistance.');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Field label="AI provider">
            <select
              aria-label="AI provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value as 'openai' | 'test')}
              disabled={submitting}
            >
              <option value="openai" disabled={!status?.openAiConfigured}>
                OpenAI{status?.openAiConfigured ? '' : ' — configuration required'}
              </option>
              {status?.testAdapterEnabled && (
                <option value="test">Local fictional-customer test adapter</option>
              )}
            </select>
          </Field>
          {provider === 'test' && (
            <p className="account-notice">
              Test output is generated by an explicit local catalogue rule adapter. It is not an OpenAI
              response.
            </p>
          )}
          <Field label="Design brief">
            <textarea
              aria-label="Design brief"
              required
              minLength={3}
              maxLength={2000}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
            />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={usePhotos}
              disabled={provider !== 'openai' || !references.length}
              onChange={(event) => setUsePhotos(event.target.checked)}
            />{' '}
            Use the first two room photographs with OpenAI
          </label>
          <p className="account-muted">
            If selected, these private references are sent to OpenAI for visual guidance. Stored measurements
            stay authoritative.
          </p>
          <Button
            type="submit"
            variant="primary"
            disabled={
              !current ||
              busy ||
              !!proposal ||
              submitting ||
              ['queued', 'running'].includes(job?.status ?? '') ||
              (!status?.openAiConfigured && provider === 'openai')
            }
          >
            Request design assistance
          </Button>
          <Button type="button" onClick={() => void load()}>
            Refresh assistant availability
          </Button>
        </form>
      )}
      {job && (
        <p role="status">
          Assistance job: {job.status}
          {job.errorCode
            ? ` · ${job.errorCode}. Review the current scene, catalogue and provider configuration before retrying.`
            : ''}
        </p>
      )}
      {result && (
        <div role="region" aria-label="Design assistance result">
          <p>{result.summary}</p>
          <p>
            Estimated total with retailer charges:{' '}
            <strong>
              {formatMoney(result.calculation.totals.grandTotalMinor, result.calculation.policy.currency)}
            </strong>
            {result.overBudget ? ' · exceeds saved budget' : ''}
          </p>
          {result.proposal && (
            <Button
              disabled={busy || !!proposal || current?.version !== result.baseVersion}
              onClick={() => {
                if (!reviewProposal(result.proposal!, `/api/projects/${projectId}/scene`))
                  setError('The scene changed or another preview is open. Request fresh assistance.');
              }}
            >
              Review suggested layout
            </Button>
          )}
          {staff && result.recommendations.length > 0 && (
            <>
              <div className="business-form-row">
                <Field label="Recommendation X (m)">
                  <input
                    aria-label="Recommendation X (m)"
                    type="number"
                    step="0.1"
                    value={x}
                    onChange={(event) => setX(event.target.value)}
                  />
                </Field>
                <Field label="Recommendation Z (m)">
                  <input
                    aria-label="Recommendation Z (m)"
                    type="number"
                    step="0.1"
                    value={z}
                    onChange={(event) => setZ(event.target.value)}
                  />
                </Field>
              </div>
              <div className="business-card-list">
                {result.recommendations.map((item) => (
                  <article className="business-record" key={item.variantId}>
                    <div>
                      <strong>
                        {item.name} — {item.variantName}
                      </strong>
                      <p>
                        {item.sku} · {formatMoney(item.priceMinor, item.currency)} each · suggested quantity{' '}
                        {item.quantity}
                      </p>
                    </div>
                    <Button
                      disabled={busy || !!proposal || !current}
                      onClick={() => {
                        if (!current) return;
                        void preview({
                          type: 'add-object',
                          object: {
                            id: crypto.randomUUID(),
                            variantId: item.variantId,
                            sku: item.sku,
                            name: item.name,
                            category: item.category,
                            dimensions: item.dimensions,
                            color: item.color,
                            solid: item.category !== 'rug',
                            locks: { position: false, rotation: false, product: false },
                            transform: {
                              x: x === '' ? current.room.width / 2 : Number(x),
                              y: 0,
                              z: z === '' ? current.room.depth / 2 : Number(z),
                              rotation: 0,
                            },
                          },
                        });
                      }}
                    >
                      Preview one {item.name}
                    </Button>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
