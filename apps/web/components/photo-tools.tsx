'use client';
import { useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import type { PhotoRegion, PhotoWorkspace } from '../lib/photo-contract';
import { photoRegionSchema } from '../lib/photo-contract';
import { useEditor } from '../lib/editor-store';
import { accountRequest } from './workspace-frame';
import { PixelMaskEditor } from './pixel-mask-editor';
interface PhotoJob {
  id: string;
  kind: string;
  status: string;
  errorCode: string | null;
  result: {
    referenceId: string;
    workspaceRevision: number;
    generatedReferenceId?: string;
    analysis?: { summary: string; objects: { label: string; bounds: PhotoRegion['bounds'] }[] };
  } | null;
}
interface Status {
  openAiConfigured: boolean;
  testAdapterEnabled: boolean;
  jobs: PhotoJob[];
}
export function PhotoPhotoTools({
  projectId,
  workspace,
  readOnly,
  save,
  onError,
  imageSize,
  workspaceSaving = false,
  onPendingChange,
  sourceUrl,
  onReplace,
}: {
  projectId: string;
  workspace: PhotoWorkspace;
  readOnly: boolean;
  save: (update: Partial<PhotoWorkspace>) => Promise<PhotoWorkspace | undefined>;
  onError: (message: string) => void;
  imageSize: { width: number; height: number };
  workspaceSaving?: boolean;
  onPendingChange?: (pending: boolean) => void;
  sourceUrl?: string;
  onReplace?: (region: PhotoRegion) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [provider, setProvider] = useState<'openai' | 'test'>('openai'),
    [consent, setConsent] = useState(false),
    [regions, setRegions] = useState(workspace.regions),
    [pending, setPending] = useState(false),
    [replacementTarget, setReplacementTarget] = useState<PhotoRegion | null>(null),
    [obstacle, setObstacle] = useState({ x: 1, z: 1, width: 1, depth: 1, name: 'Existing furniture' });
  const { scene, proposal, busy, preview } = useEditor();
  const path = `/api/projects/${projectId}/photos/${workspace.referenceId}/jobs`;
  useEffect(() => {
    setRegions(workspace.regions);
  }, [workspace]);
  useEffect(() => {
    setConsent(false);
    setStatus(null);
    const controller = new AbortController();
    const load = async () => {
      try {
        const value = await accountRequest<Status>(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatus(value);
        if (!value.openAiConfigured && value.testAdapterEnabled) setProvider('test');
      } catch {
        if (!controller.signal.aborted) onError('Photograph processing status is unavailable.');
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [path]);
  const changed = JSON.stringify(regions) !== JSON.stringify(workspace.regions),
    running = pending || Boolean(status?.jobs.some((j) => ['queued', 'running'].includes(j.status)));
  useEffect(() => {
    onPendingChange?.(changed || running || workspaceSaving);
  }, [onPendingChange, changed, running, workspaceSaving]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  async function queue(kind: 'photo_analysis' | 'photo_cleanup', target: PhotoWorkspace = workspace) {
    setPending(true);
    onError('');
    try {
      await accountRequest(path, {
        method: 'POST',
        body: {
          kind,
          provider,
          referenceId: target.referenceId,
          expectedRevision: target.revision,
          consent: true,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      const next = await accountRequest<Status>(path);
      setStatus(next);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Photograph request failed.');
    } finally {
      setPending(false);
    }
  }
  // Poll jobs created after initial mount, aborting when this photograph is left.
  const activeId = status?.jobs.find((j) => ['queued', 'running'].includes(j.status))?.id;
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await accountRequest<Status>(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatus(value);
        if (value.jobs.some((j) => ['queued', 'running'].includes(j.status)))
          timer = setTimeout(() => void poll(), 1800);
      } catch {
        if (!controller.signal.aborted) onError('Photograph job status could not be loaded.');
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeId, path]);
  if (readOnly) return null;
  function update(id: string, value: Partial<PhotoRegion>) {
    setRegions((old) => old.map((r) => (r.id === id ? { ...r, ...value } : r)));
  }
  const analysis = status?.jobs.find(
    (j) =>
      j.kind === 'photo_analysis' &&
      j.status === 'completed' &&
      j.result?.workspaceRevision === workspace.revision,
  )?.result?.analysis;
  const cleanup = status?.jobs.find(
    (j) =>
      j.kind === 'photo_cleanup' &&
      j.status === 'completed' &&
      j.result?.workspaceRevision === workspace.revision,
  );
  const disabled = running || busy || workspaceSaving || Boolean(proposal);
  return (
    <div className="photo-tools" aria-label="Existing furniture in photograph">
      <h3>Existing furniture in the photograph</h3>
      <p>
        Scan for visible furniture and review what to keep or remove. Check for missed or partly hidden
        objects and add selections where needed. AI areas are approximate; they do not establish measurements
        or physical clearance.
      </p>
      <Field label="Photograph AI provider">
        <select
          aria-label="Photograph AI provider"
          value={provider}
          disabled={disabled}
          onChange={(e) => {
            setProvider(e.target.value as 'openai' | 'test');
            setConsent(false);
          }}
        >
          <option value="openai" disabled={!status?.openAiConfigured}>
            OpenAI · live photograph processing
          </option>
          {status?.testAdapterEnabled && (
            <option value="test">Local fixture adapter · registered photos only</option>
          )}
        </select>
      </Field>
      {provider === 'openai' ? (
        <label>
          <input
            type="checkbox"
            checked={consent}
            disabled={disabled}
            onChange={(e) => setConsent(e.target.checked)}
          />{' '}
          I consent to sending this selected photograph to OpenAI for analysis or removal.
        </label>
      ) : (
        <p>
          Demonstration only: recorded selections and a prepared cleanup for the supplied fictional
          photographs. No live photograph analysis is performed.
        </p>
      )}
      <Button
        disabled={disabled || changed || (provider === 'openai' && (!consent || !status?.openAiConfigured))}
        onClick={() => void queue('photo_analysis')}
      >
        Scan room photograph
      </Button>
      <Button
        disabled={disabled || regions.length >= 30}
        onClick={() =>
          setRegions((old) => [
            ...old,
            {
              id: crypto.randomUUID(),
              label: 'Existing furniture',
              bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
              disposition: 'keep',
              foreground: false,
            },
          ])
        }
      >
        Add furniture selection
      </Button>
      {analysis && (
        <div className="account-notice">
          <p>{analysis.summary}</p>
          <Button
            disabled={disabled || changed}
            onClick={() =>
              setRegions(
                analysis.objects.map((item) => ({
                  ...item,
                  id: crypto.randomUUID(),
                  disposition: 'keep',
                  foreground: false,
                })),
              )
            }
          >
            Use detected selections
          </Button>
        </div>
      )}
      {regions.map((region, index) => (
        <div className="photo-analysis-item" id={`photo-region-${region.id}`} key={region.id}>
          <Field label={`Selection ${index + 1} label`}>
            <input
              aria-label={`Selection ${index + 1} label`}
              disabled={disabled}
              value={region.label}
              onChange={(e) => update(region.id, { label: e.target.value })}
            />
          </Field>
          <Button
            disabled={disabled || (provider === 'openai' && (!consent || !status?.openAiConfigured))}
            onClick={async () => {
              const next = regions.map((r) =>
                r.id === region.id ? { ...r, disposition: 'remove' as const, foreground: false } : r,
              );
              setRegions(next);
              const saved = await save({ regions: next });
              if (saved) await queue('photo_cleanup', saved);
            }}
          >
            Remove this object
          </Button>
          <Button
            disabled={disabled || (provider === 'openai' && (!consent || !status?.openAiConfigured))}
            onClick={async () => {
              const replacement = { ...region, disposition: 'remove' as const, foreground: false };
              const next = regions.map((r) => (r.id === region.id ? replacement : r));
              setRegions(next);
              const saved = await save({ regions: next });
              if (saved) {
                setReplacementTarget(replacement);
                await queue('photo_cleanup', saved);
              }
            }}
          >
            Replace this object from store
          </Button>
          <Field label="Existing object action">
            <select
              aria-label={`Selection ${index + 1} action`}
              disabled={disabled}
              value={region.disposition}
              onChange={(e) =>
                update(region.id, { disposition: e.target.value as 'keep' | 'remove', foreground: false })
              }
            >
              <option value="keep">Keep in photograph</option>
              <option value="remove">Remove from photograph</option>
            </select>
          </Field>
          <details className="photo-region-adjustment">
            <summary>Adjust detected area</summary>
            <p>
              Image: {imageSize.width} × {imageSize.height} px. These coordinates are percentages of the
              photograph.
            </p>
            <div className="photo-fields">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <Field key={key} label={`${key} (%)`}>
                  <input
                    aria-label={`Selection ${index + 1} ${key} (%)`}
                    disabled={disabled}
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={Number((region.bounds[key] * 100).toFixed(2))}
                    onChange={(e) =>
                      update(region.id, { bounds: { ...region.bounds, [key]: Number(e.target.value) / 100 } })
                    }
                  />
                </Field>
              ))}
            </div>
            <label>
              <input
                type="checkbox"
                disabled={disabled || region.disposition !== 'keep'}
                checked={region.foreground}
                onChange={(e) => update(region.id, { foreground: e.target.checked })}
              />{' '}
              Keep this rectangular area in front of new products
            </label>
          </details>
          {sourceUrl && (
            <PixelMaskEditor
              sourceUrl={sourceUrl}
              mask={{ automatic: false, strokes: region.maskStrokes ?? [], outline: region.outline }}
              bounds={region.bounds}
              disabled={disabled}
              label={`Refine ${region.label} selection`}
              onChange={(mask) => update(region.id, { maskStrokes: mask.strokes })}
            />
          )}
          <Button
            disabled={disabled}
            onClick={() => setRegions((old) => old.filter((r) => r.id !== region.id))}
          >
            Discard selection {index + 1}
          </Button>
        </div>
      ))}
      <Button
        variant="primary"
        disabled={disabled || !changed}
        onClick={async () => {
          const parsed = regions.map((r) => photoRegionSchema.safeParse(r));
          if (parsed.some((r) => !r.success)) {
            onError('Check selection labels and bounds: every area must stay inside the photograph.');
            return;
          }
          await save({ regions });
        }}
      >
        Save reviewed selections
      </Button>
      <Button
        disabled={
          disabled ||
          changed ||
          !workspace.regions.some((r) => r.disposition === 'remove') ||
          (provider === 'openai' && (!consent || !status?.openAiConfigured))
        }
        onClick={() => void queue('photo_cleanup')}
      >
        Remove reviewed areas from photo
      </Button>
      {running && (
        <p role="status">
          Processing photograph in the background. Furniture movement uses the calibrated view and does not
          call AI.
        </p>
      )}
      {status?.jobs.slice(0, 3).map((job) => (
        <p key={job.id} role="status">
          {job.kind === 'photo_analysis' ? 'Room scan' : 'Photo cleanup'}: {job.status}
          {job.errorCode ? ` (${job.errorCode})` : ''}
        </p>
      ))}
      {cleanup?.result?.generatedReferenceId && (
        <div>
          <p>
            Review the reconstructed areas before using this image. Original room pixels outside your
            selections are preserved.
          </p>
          <img
            className="photo-cleanup-preview"
            alt="Reviewed cleaned photograph preview"
            src={`/api/projects/${projectId}/references/${cleanup.result.generatedReferenceId}`}
          />
          <Button
            disabled={disabled || changed}
            onClick={async () => {
              if (await save({ backgroundReferenceId: cleanup.result!.generatedReferenceId! })) {
                if (replacementTarget) onReplace?.(replacementTarget);
                setReplacementTarget(null);
              }
            }}
          >
            Use cleaned photograph
          </Button>
        </div>
      )}
      {workspace.backgroundReferenceId && (
        <Button disabled={disabled} onClick={() => void save({ backgroundReferenceId: null })}>
          Restore original background
        </Button>
      )}
      <details>
        <summary>Confirm an existing object's physical footprint</summary>
        <p>
          Keeping an object in the photo does not make it a collision obstacle. Measure its floor footprint
          and position to add an obstacle to the shared scene. Remove its obstacle in Room essentials if the
          real object is removed.
        </p>
        <div className="photo-fields">
          {(['x', 'z', 'width', 'depth'] as const).map((key) => (
            <Field key={key} label={`Obstacle ${key} (m)`}>
              <input
                aria-label={`Photo obstacle ${key} (m)`}
                disabled={disabled}
                type="number"
                step="0.01"
                value={obstacle[key]}
                onChange={(e) => setObstacle({ ...obstacle, [key]: Number(e.target.value) })}
              />
            </Field>
          ))}
        </div>
        <Button
          disabled={disabled || !scene}
          onClick={() => {
            if (scene)
              void preview({
                type: 'room',
                room: {
                  ...scene.room,
                  zones: [...scene.room.zones, { ...obstacle, id: crypto.randomUUID(), kind: 'obstacle' }],
                },
              });
          }}
        >
          Preview measured obstacle
        </Button>
      </details>
    </div>
  );
}
