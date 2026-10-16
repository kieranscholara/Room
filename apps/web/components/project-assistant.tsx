'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import type { Proposal } from '@roomsell/scene-core';
import type { QuotationPricing } from '@roomsell/pricing';
import type {
  AssistantCandidate,
  AssistantExistingFurniture,
  AssistantSceneRemoval,
} from '../lib/assistant-contract';
import type { PhotoConsultationStatus } from '../lib/photo-consultation-status';
import type { PhotoWorkspace } from '../lib/photo-contract';
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
  sceneRemovals?: AssistantSceneRemoval[];
  existingFurniture?: AssistantExistingFurniture[];
  photoWorkspaces?: { referenceId: string; expectedRevision: number }[];
  calculationBasis?: string;
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
  photoContext,
  onPhotoAdviceApplied,
  onPhotoPendingChange,
  onChooseProduct,
}: {
  projectId: string;
  canEdit: boolean;
  staff: boolean;
  photoContext?: PhotoConsultationStatus;
  onPhotoAdviceApplied?: () => void;
  onPhotoPendingChange?: (pending: boolean) => void;
  onChooseProduct?: (variantId: string, sku: string) => void;
}) {
  const { scene, endpoint, proposal, busy, preview, reviewProposal } = useEditor(),
    current = endpoint === `/api/projects/${projectId}/scene` ? scene : null;
  const latestContext = useRef({ projectId, canEdit, staff, photoContext });
  latestContext.current = { projectId, canEdit, staff, photoContext };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onPhotoPendingChange?.(false);
    };
  }, [onPhotoPendingChange]);
  const [status, setStatus] = useState<{ openAiConfigured: boolean; testAdapterEnabled: boolean } | null>(
      null,
    ),
    [provider, setProvider] = useState<'openai' | 'test'>('openai'),
    [brief, setBrief] = useState('Make the room feel open while keeping locked furniture in place.'),
    [usePhotos, setUsePhotos] = useState(false),
    [selectedReferences, setSelectedReferences] = useState<string[]>([]),
    [references, setReferences] = useState<{ id: string; name: string }[]>([]),
    [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(''),
    [submitting, setSubmitting] = useState(false),
    [reviewedPhotoIds, setReviewedPhotoIds] = useState<string[]>([]),
    [applyingPhoto, setApplyingPhoto] = useState(false);
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
      setSelectedReferences((old) => old.filter((id) => photos.some((p) => p.id === id)));
      if (!info.openAiConfigured && info.testAdapterEnabled) setProvider('test');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Assistant status unavailable.');
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setUsePhotos(false);
    setSelectedReferences(photoContext?.referenceId ? [photoContext.referenceId] : []);
    void load();
  }, [photoContext?.referenceId, load]);
  useEffect(() => {
    setReviewedPhotoIds([]);
  }, [job?.id, photoContext?.photoRevision]);
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
  const adviceCurrent = Boolean(
    result &&
    current?.version === result.baseVersion &&
    (!photoContext ||
      !(result.photoWorkspaces ?? []).length ||
      (result.photoWorkspaces ?? []).some(
        (p) =>
          p.referenceId === photoContext.referenceId && p.expectedRevision === photoContext.photoRevision,
      )),
  );
  const adviceDisabled =
    !canEdit || busy || Boolean(proposal) || submitting || applyingPhoto || !adviceCurrent;
  async function savePhotoAdvice(referenceId: string) {
    if (!canEdit || !staff || !result || !adviceCurrent || !current || applyingPhoto) return;
    const sceneId = current.id;
    const expectedPhoto = photoContext;
    const assertCurrent = (workspaceRevision: number) => {
      const live = useEditor.getState();
      const latest = latestContext.current;
      if (
        !mounted.current ||
        !latest.canEdit ||
        !latest.staff ||
        latest.projectId !== projectId ||
        live.endpoint !== `/api/projects/${projectId}/scene` ||
        live.scene?.id !== sceneId ||
        live.scene?.version !== result.baseVersion ||
        live.busy ||
        live.proposal ||
        (expectedPhoto &&
          (latest.photoContext?.referenceId !== referenceId ||
            latest.photoContext?.referenceId !== expectedPhoto.referenceId ||
            latest.photoContext?.photoRevision !== expectedPhoto.photoRevision ||
            latest.photoContext?.photoRevision !== workspaceRevision))
      )
        throw new Error('The room or photograph changed. Request fresh completion advice.');
    };
    setApplyingPhoto(true);
    onPhotoPendingChange?.(true);
    setError('');
    try {
      const items = (result.existingFurniture ?? []).filter(
        (a) => a.referenceId === referenceId && reviewedPhotoIds.includes(a.regionId),
      );
      if (!items.length) return;
      const workspace = await accountRequest<PhotoWorkspace>(
        `/api/projects/${projectId}/photos/${referenceId}`,
      );
      if (
        workspace.referenceId !== referenceId ||
        items.some((a) => a.workspaceRevision !== workspace.revision)
      )
        throw new Error('The room or photograph changed. Request fresh completion advice.');
      const regions = workspace.regions.map((region) => {
        const item = items.find((a) => a.regionId === region.id);
        return item
          ? {
              ...region,
              disposition: item.action,
              foreground: item.action === 'remove' ? false : region.foreground,
            }
          : region;
      });
      if (items.some((a) => !workspace.regions.some((region) => region.id === a.regionId)))
        throw new Error('A reviewed selection is no longer available.');
      assertCurrent(workspace.revision);
      await accountRequest(`/api/projects/${projectId}/photos/${referenceId}`, {
        method: 'PUT',
        body: {
          expectedRevision: workspace.revision,
          calibration: workspace.calibration,
          regions,
          backgroundReferenceId: workspace.backgroundReferenceId,
        },
      });
      if (mounted.current && latestContext.current.projectId === projectId) {
        setReviewedPhotoIds([]);
        onPhotoAdviceApplied?.();
        document.getElementById('consultation-room')?.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : 'Could not save the reviewed photo choices.');
    } finally {
      if (mounted.current) {
        setApplyingPhoto(false);
        onPhotoPendingChange?.(false);
      }
    }
  }
  return (
    <section id="project-design-assistant" className="account-panel" aria-label="Design assistant">
      <div>
        <h2>Complete the room</h2>
        <p className="account-muted">
          Review which existing pieces to keep or remove, then choose additions from the store catalogue.
          Furniture changes and photo removal areas are saved only after your review.
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
              const referenceIds =
                provider === 'test' && photoContext?.referenceId
                  ? [photoContext.referenceId]
                  : provider === 'openai' && usePhotos
                    ? photoContext?.referenceId
                      ? [photoContext.referenceId]
                      : selectedReferences
                    : [];
              const workspaces = await Promise.all(
                referenceIds.map((id) =>
                  accountRequest<PhotoWorkspace>(`/api/projects/${projectId}/photos/${id}`),
                ),
              );
              if (
                photoContext?.referenceId &&
                workspaces.some(
                  (w) =>
                    w.referenceId === photoContext.referenceId && w.revision !== photoContext.photoRevision,
                )
              )
                throw new Error('The room photograph changed. Refresh it before requesting advice.');
              setJob(
                await accountRequest<Job>(`/api/projects/${projectId}/assistant`, {
                  method: 'POST',
                  body: {
                    brief,
                    expectedSceneVersion: current.version,
                    provider,
                    referenceIds,
                    photoWorkspaces: workspaces.map((w) => ({
                      referenceId: w.referenceId,
                      expectedRevision: w.revision,
                    })),
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
              onChange={(event) => {
                setUsePhotos(event.target.checked);
                if (event.target.checked) void load();
              }}
            />{' '}
            I consent to sending the selected room photographs to OpenAI
          </label>
          {photoContext?.referenceId && (
            <p className="account-muted">Advice will use the room photograph currently open above.</p>
          )}
          {usePhotos && provider === 'openai' && !photoContext && (
            <fieldset>
              <legend>Choose up to two photographs for inventory suggestions</legend>
              {references.map((photo) => (
                <label key={photo.id}>
                  <input
                    type="checkbox"
                    aria-label={`Use photograph ${photo.name}`}
                    checked={selectedReferences.includes(photo.id)}
                    disabled={!selectedReferences.includes(photo.id) && selectedReferences.length >= 2}
                    onChange={(e) =>
                      setSelectedReferences((old) =>
                        e.target.checked ? [...old, photo.id] : old.filter((id) => id !== photo.id),
                      )
                    }
                  />
                  {photo.name}
                </label>
              ))}
            </fieldset>
          )}
          <p className="account-muted">
            If selected, these private references are sent to OpenAI for visual guidance. Stored measurements
            stay authoritative.
          </p>
          {photoContext && (!photoContext.referenceId || !current?.room.measurementsConfirmed) && (
            <p className="account-notice">
              Upload the room photograph and confirm its measured dimensions before requesting completion
              advice.
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={
              !current ||
              busy ||
              !!proposal ||
              submitting ||
              ['queued', 'running'].includes(job?.status ?? '') ||
              (!status?.openAiConfigured && provider === 'openai') ||
              (provider === 'openai' &&
                usePhotos &&
                !photoContext?.referenceId &&
                !selectedReferences.length) ||
              Boolean(photoContext && (!photoContext.referenceId || !current?.room.measurementsConfirmed)) ||
              Boolean(photoContext?.referenceId && provider === 'openai' && !usePhotos)
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
            {result.calculationBasis === 'projected_completion'
              ? 'Proposed completion estimate with retailer charges:'
              : 'Estimated total with retailer charges:'}{' '}
            <strong>
              {formatMoney(result.calculation.totals.grandTotalMinor, result.calculation.policy.currency)}
            </strong>
            {result.overBudget ? ' · exceeds saved budget' : ''}
          </p>
          {result.proposal && (
            <Button
              disabled={adviceDisabled}
              onClick={() => {
                if (!reviewProposal(result.proposal!, `/api/projects/${projectId}/scene`))
                  setError('The scene changed or another preview is open. Request fresh assistance.');
              }}
            >
              Review suggested layout
            </Button>
          )}
          {!adviceCurrent && (
            <p className="account-notice">
              The design or reviewed photograph has changed. Request fresh advice before applying these
              suggestions.
            </p>
          )}
          {staff && Boolean(result.sceneRemovals?.length) && (
            <div aria-label="Suggested catalogue removals">
              <h3>Suggested removals from the chosen products</h3>
              {result.sceneRemovals!.map((item) => (
                <article className="business-record" key={item.objectId}>
                  <div>
                    <strong>{item.name}</strong>
                    <p>{item.rationale}</p>
                  </div>
                  <Button disabled={adviceDisabled} onClick={() => void preview(item.operation)}>
                    Preview removal of {item.name}
                  </Button>
                </article>
              ))}
            </div>
          )}
          {staff && Boolean(result.existingFurniture?.length) && (
            <div aria-label="Suggested existing furniture choices">
              <h3>Existing furniture in the room photograph</h3>
              <p>
                Select the advice you agree with. Saving a removal choice marks its area for review; use the
                photograph tools to generate and approve the cleaned image.
              </p>
              {[...new Set(result.existingFurniture!.map((item) => item.referenceId))].map((referenceId) => (
                <div key={referenceId}>
                  {result
                    .existingFurniture!.filter((item) => item.referenceId === referenceId)
                    .map((item) => (
                      <article className="business-record" key={item.regionId}>
                        <label>
                          <input
                            type="checkbox"
                            aria-label={`Use suggestion for ${item.label}`}
                            disabled={adviceDisabled}
                            checked={reviewedPhotoIds.includes(item.regionId)}
                            onChange={(event) =>
                              setReviewedPhotoIds((old) =>
                                event.target.checked
                                  ? [...old, item.regionId]
                                  : old.filter((id) => id !== item.regionId),
                              )
                            }
                          />
                          <strong>
                            {item.label}: {item.action === 'remove' ? 'suggested removal' : 'suggested keep'}
                          </strong>
                          <p>{item.rationale}</p>
                        </label>
                      </article>
                    ))}
                  <Button
                    disabled={
                      adviceDisabled ||
                      !result.existingFurniture!.some(
                        (item) =>
                          item.referenceId === referenceId && reviewedPhotoIds.includes(item.regionId),
                      )
                    }
                    onClick={() => void savePhotoAdvice(referenceId)}
                  >
                    Save reviewed photo choices
                  </Button>
                </div>
              ))}
            </div>
          )}
          {staff && result.recommendations.length > 0 && (
            <>
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
                      disabled={
                        adviceDisabled ||
                        !current ||
                        !photoContext?.calibrated ||
                        !photoContext.imageReady ||
                        !onChooseProduct
                      }
                      onClick={() => onChooseProduct?.(item.variantId, item.sku)}
                    >
                      Choose {item.name} for photograph
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
