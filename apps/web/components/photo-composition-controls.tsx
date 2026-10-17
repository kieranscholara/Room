'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Scene } from '@roomsell/scene-core';
import type { SelectedProjectProducts } from '@roomsell/catalogue';
import { Button } from '@roomsell/ui';
import type { PhotoWorkspace } from '../lib/photo-contract';
import type { PhotoComposition, PhotoImageLayer } from '../lib/photo-image-contract';
import { accountRequest } from './workspace-frame';
import { PixelMaskEditor } from './pixel-mask-editor';

interface RenderJob {
  id: string;
  status: string;
  errorCode: string | null;
  result: null | {
    referenceId: string;
    compositionRevision: number;
    sceneVersion: number;
    photoRevision: number;
    renderedReferenceId: string;
    imageSha256: string;
  };
}
interface CompositionStatus {
  composition: PhotoComposition | null;
  openAiConfigured: boolean;
  jobs: RenderJob[];
}
export function usePhotoComposition(
  projectId: string,
  referenceId: string,
  scene: Scene | null,
  workspace: PhotoWorkspace | null,
) {
  const [status, setStatus] = useState<CompositionStatus | null>(null),
    [layers, setLayers] = useState<PhotoImageLayer[]>([]),
    [products, setProducts] = useState<SelectedProjectProducts | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [readyImages, setReadyImages] = useState<Record<string, boolean>>({}),
    [loadedScope, setLoadedScope] = useState('');
  const scope = `${projectId}:${referenceId}`,
    live = useRef(scope),
    layerScope = useRef('');
  live.current = scope;
  const path = `/api/projects/${projectId}/photos/${referenceId}/composition`;
  useEffect(() => {
    if (!referenceId || !scene || workspace?.referenceId !== referenceId) return;
    const controller = new AbortController();
    setPending(true);
    void Promise.all([
      accountRequest<CompositionStatus>(path, { signal: controller.signal }),
      accountRequest<SelectedProjectProducts>(`/api/projects/${projectId}/products`, {
        signal: controller.signal,
      }),
    ])
      .then(([value, items]) => {
        if (controller.signal.aborted) return;
        setStatus(value);
        setProducts(items);
        setError('');
        setLoadedScope(scope);
        const sameScope = layerScope.current === scope;
        setLayers((old) =>
          items.items.flatMap((item) => {
            const previous =
              (sameScope ? old : []).find((l) => l.objectId === item.objectId) ??
              value.composition?.layers.find((l) => l.objectId === item.objectId);
            const asset =
              (previous && item.assets.find((a) => a.id === previous.assetId && a.kind === 'image')) ||
              item.assets.find((a) => a.kind === 'image' && a.validation.hasAlpha === true) ||
              item.assets.find((a) => a.kind === 'image');
            return asset
              ? [
                  previous && asset.id === previous.assetId
                    ? previous
                    : { objectId: item.objectId, assetId: asset.id, mask: { automatic: true, strokes: [] } },
                ]
              : [];
          }),
        );
        layerScope.current = scope;
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Photo composition unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [path, projectId, referenceId, scene?.version, scene?.id, workspace?.revision, refresh]);
  const activeJob = (loadedScope === scope ? status : null)?.jobs.find(
    (j) => j.status === 'queued' || j.status === 'running',
  )?.id;
  useEffect(() => {
    if (!activeJob) return;
    let cancelled = false;
    const timer = setInterval(
      () =>
        void accountRequest<CompositionStatus>(path)
          .then((value) => {
            if (!cancelled) setStatus(value);
          })
          .catch(() => {
            if (!cancelled) setError('Could not refresh image rendering.');
          }),
      1500,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeJob, path]);
  const composition = loadedScope === scope ? (status?.composition ?? null) : null;
  const dirty = Boolean(
    scene &&
    workspace &&
    (composition?.sceneVersion !== scene.version ||
      composition?.photoRevision !== workspace.revision ||
      JSON.stringify(composition?.layers) !== JSON.stringify(layers)),
  );
  const render = (loadedScope === scope ? status : null)?.jobs.find(
    (j) =>
      j.status === 'completed' &&
      j.result?.compositionRevision === composition?.revision &&
      j.result?.sceneVersion === scene?.version &&
      j.result?.photoRevision === workspace?.revision,
  );
  const currentRender = Boolean(
    !dirty &&
    composition?.renderedReferenceId &&
    composition.sceneVersion === scene?.version &&
    composition.photoRevision === workspace?.revision,
  );
  const imageReady = Boolean(
    scene &&
    loadedScope === scope &&
    layers.length === scene.objects.length &&
    layers.every((l) => readyImages[l.objectId]) &&
    !pending &&
    !activeJob,
  );
  const onImageReady = useCallback(
    (id: string, ready: boolean) =>
      setReadyImages((old) => (old[id] === ready ? old : { ...old, [id]: ready })),
    [],
  );
  async function write(action: 'save' | 'apply', jobId?: string) {
    if (!scene || !workspace) return;
    setPending(true);
    setError('');
    try {
      const value = await accountRequest<PhotoComposition>(path, {
        method: 'PUT',
        body: {
          action,
          expectedRevision: composition?.revision ?? 0,
          expectedSceneVersion: scene.version,
          expectedPhotoRevision: workspace.revision,
          ...(action === 'save' ? { layers } : { jobId }),
        },
      });
      if (live.current !== scope) return;
      setStatus((old) => ({ ...old!, composition: value }));
      return value;
    } catch (reason) {
      if (live.current === scope)
        setError(reason instanceof Error ? reason.message : 'Could not save photograph.');
    } finally {
      if (live.current === scope) setPending(false);
    }
  }
  async function queue(provider: 'local' | 'openai', consent: boolean) {
    if (!scene || !workspace || !composition) return;
    setPending(true);
    setError('');
    try {
      const job = await accountRequest<RenderJob>(path, {
        method: 'POST',
        body: {
          expectedRevision: composition.revision,
          expectedSceneVersion: scene.version,
          expectedPhotoRevision: workspace.revision,
          provider,
          consent,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (live.current === scope) setStatus((old) => ({ ...old!, jobs: [job, ...(old?.jobs ?? [])] }));
    } catch (reason) {
      if (live.current === scope)
        setError(reason instanceof Error ? reason.message : 'Could not render photograph.');
    } finally {
      if (live.current === scope) setPending(false);
    }
  }
  return {
    status: loadedScope === scope ? status : null,
    layers: loadedScope === scope ? layers : [],
    setLayers,
    products: loadedScope === scope ? products : null,
    pending: pending || Boolean(activeJob),
    error,
    dirty,
    composition,
    render,
    currentRender,
    imageReady,
    onImageReady,
    write,
    queue,
    reload: () => setRefresh((v) => v + 1),
  };
}
export type PhotoCompositionController = ReturnType<typeof usePhotoComposition>;
export function PhotoCompositionControls({
  controller,
  projectId,
  selectedId,
  readOnly,
  blocked,
}: {
  controller: PhotoCompositionController;
  projectId: string;
  selectedId: string | null;
  readOnly: boolean;
  blocked: boolean;
}) {
  const [consent, setConsent] = useState(false),
    [ai, setAi] = useState(false);
  const c = controller,
    selected = c.layers.find((l) => l.objectId === selectedId),
    product = c.products?.items.find((i) => i.objectId === selectedId);
  const disabled = readOnly || blocked || c.pending;
  return (
    <section className="photo-composition-controls" aria-label="Save the edited photograph">
      <h3>Save the edited photograph</h3>
      <p>
        Products are editable catalogue-image cutouts. Moving them is immediate; the final image is rendered
        separately. Catalogue views stay as supplied—there is no invented 360° view.
      </p>
      {c.error && (
        <p role="alert" className="account-error">
          {c.error}
        </p>
      )}
      {selected && product && (
        <>
          <label>
            Product photograph{' '}
            <select
              aria-label="Product photograph view"
              disabled={disabled}
              value={selected.assetId}
              onChange={(e) =>
                c.setLayers((old) =>
                  old.map((l) =>
                    l.objectId === selected.objectId
                      ? { ...l, assetId: e.target.value, mask: { automatic: true, strokes: [] } }
                      : l,
                  ),
                )
              }
            >
              {product.assets
                .filter((a) => a.kind === 'image')
                .map((a, i) => (
                  <option key={a.id} value={a.id}>
                    Catalogue view {i + 1}
                  </option>
                ))}
            </select>
          </label>
          <PixelMaskEditor
            key={selected.assetId}
            sourceUrl={`/api/projects/${projectId}/assets/${selected.assetId}`}
            mask={selected.mask}
            disabled={disabled}
            label="Refine product cutout"
            onChange={(mask) =>
              c.setLayers((old) => old.map((l) => (l.objectId === selected.objectId ? { ...l, mask } : l)))
            }
          />
        </>
      )}
      <div className="photo-actions">
        <Button disabled={disabled || !c.imageReady || !c.dirty} onClick={() => void c.write('save')}>
          Save image layers
        </Button>
        <Button
          disabled={
            disabled || c.dirty || !c.composition || !c.layers.length || !c.imageReady || (ai && !consent)
          }
          onClick={() => void c.queue(ai ? 'openai' : 'local', consent)}
        >
          Render final photograph
        </Button>
      </div>
      {c.status?.openAiConfigured && (
        <>
          <label>
            <input
              type="checkbox"
              checked={ai}
              disabled={disabled}
              onChange={(e) => {
                setAi(e.target.checked);
                setConsent(false);
              }}
            />{' '}
            Refine contact lighting with OpenAI
          </label>
          {ai && (
            <label>
              <input
                type="checkbox"
                checked={consent}
                disabled={disabled}
                onChange={(e) => setConsent(e.target.checked)}
              />{' '}
              I consent to sending this composed photograph to OpenAI for lighting.
            </label>
          )}
        </>
      )}
      {c.pending && <p role="status">Preparing the photograph…</p>}
      {c.status?.jobs.slice(0, 1).map((job) => (
        <p key={job.id} role="status">
          Final photograph: {job.status}
          {job.errorCode ? ` (${job.errorCode})` : ''}
        </p>
      ))}
      {c.status?.jobs.find((j) => j.status === 'failed') && !c.render && (
        <p role="alert">
          The last image render failed ({c.status.jobs.find((j) => j.status === 'failed')?.errorCode}). Review
          the current image and retry.
        </p>
      )}
      {c.dirty && <p role="status">Image layers have unsaved changes. Save and render before confirming.</p>}
      {c.render?.result && !c.dirty && (
        <div>
          <img
            className="photo-final-preview"
            alt="Final edited room photograph preview"
            src={`/api/projects/${projectId}/references/${c.render.result.renderedReferenceId}`}
          />
          <Button disabled={disabled || c.currentRender} onClick={() => void c.write('apply', c.render!.id)}>
            Use final photograph
          </Button>
        </div>
      )}
      {c.currentRender && (
        <>
          <p role="status">Final photograph saved. Review the client’s choices below to confirm and quote.</p>
          <a
            className="business-text-link"
            href={`/api/projects/${projectId}/references/${c.composition!.renderedReferenceId}`}
            download="client-room-design.png"
          >
            Download edited photograph
          </a>
        </>
      )}
    </section>
  );
}
