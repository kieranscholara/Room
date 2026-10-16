'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Matrix4, PerspectiveCamera } from 'three';
import {
  calibratePhoto,
  photoPointToFloor,
  photoPointToPlane,
  type PhotoCalibration,
  type PhotoCamera,
  type PhotoPoint,
} from '@roomsell/geometry';
import { propose } from '@roomsell/layout-engine';
import type { Operation, Scene, SceneObject } from '@roomsell/scene-core';
import { isCatalogueVariantAvailable } from '@roomsell/catalogue';
import { Button, Field } from '@roomsell/ui';
import { useEditor } from '../lib/editor-store';
import type { PhotoWorkspace } from '../lib/photo-contract';
import type { PhotoConsultationStatus, PhotoPlacementRequest } from '../lib/photo-consultation-status';
import { accountRequest } from './workspace-frame';
import type { CatalogueProduct } from './workspace-business-types';
import { formatMoney } from './workspace-business-types';
import { Furniture3D, useProjectModels, ViewerBoundary } from './room-viewer-3d';
import { PhotoPhotoTools } from './photo-tools';
import './photo-studio.css';

interface Reference {
  id: string;
  name: string;
  url: string;
}
interface PhotoRenderStatus {
  sceneId: string;
  canvasReady: boolean;
  objects: Record<string, { kind: 'model' | 'proxy'; assetId?: string }>;
}
function CalibratedCamera({ pose }: { pose: PhotoCamera }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const [x, y, z] = pose.axes,
      t = pose.translation;
    const view = new Matrix4().set(
      x[0],
      y[0],
      z[0],
      t[0],
      -x[1],
      -y[1],
      -z[1],
      -t[1],
      -x[2],
      -y[2],
      -z[2],
      -t[2],
      0,
      0,
      0,
      1,
    );
    view.invert().decompose(camera.position, camera.quaternion, camera.scale);
    camera.fov = (2 * Math.atan(pose.height / (2 * pose.focal)) * 180) / Math.PI;
    camera.aspect = pose.width / pose.height;
    camera.near = 0.01;
    camera.far = 200;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    invalidate();
  }, [pose, camera, invalidate]);
  return null;
}
function PhotoFurniture({
  projectId,
  scene,
  pose,
  onStart,
  onRenderStatusChange,
}: {
  projectId: string;
  scene: Scene;
  pose: PhotoCamera;
  onStart: (object: SceneObject, event: globalThis.PointerEvent, height: number) => void;
  onRenderStatusChange: (status: PhotoRenderStatus) => void;
}) {
  const { selectedId, select } = useEditor(),
    { resolutions, loaded, catalogueError, catalogueReady } = useProjectModels(projectId, scene, 0);
  const [canvasReady, setCanvasReady] = useState(false);
  const modelsReady =
    catalogueReady &&
    scene.objects.every((object) => {
      const resolution = resolutions.get(object.id);
      return (
        resolution?.kind === 'proxy' || (resolution?.kind === 'model' && loaded.has(resolution.asset.id))
      );
    });
  const renderStatus = useMemo<PhotoRenderStatus>(
    () => ({
      sceneId: scene.id,
      canvasReady: canvasReady && modelsReady,
      objects: Object.fromEntries(
        scene.objects.map((object) => {
          const resolution = resolutions.get(object.id);
          const model = resolution?.kind === 'model' && loaded.get(resolution.asset.id)?.model;
          return [
            object.id,
            model && resolution?.kind === 'model'
              ? { kind: 'model', assetId: resolution.asset.id }
              : { kind: 'proxy' },
          ];
        }),
      ),
    }),
    [scene, resolutions, loaded, canvasReady, modelsReady],
  );
  useEffect(() => onRenderStatusChange(renderStatus), [onRenderStatusChange, renderStatus]);
  useEffect(
    () => () => onRenderStatusChange({ sceneId: scene.id, canvasReady: false, objects: {} }),
    [onRenderStatusChange, scene.id],
  );
  const modelCount = Object.values(renderStatus.objects).filter((item) => item.kind === 'model').length;
  return (
    <>
      <p
        className="photo-proxy-note"
        data-testid="photo-model-status"
        data-ready={canvasReady && modelsReady}
        style={{ position: 'absolute', bottom: 0, left: 0, zIndex: 1, pointerEvents: 'none' }}
      >
        {modelCount} loaded catalogue {modelCount === 1 ? 'model' : 'models'} ·{' '}
        {scene.objects.length - modelCount} measured box{' '}
        {scene.objects.length - modelCount === 1 ? 'placeholder' : 'placeholders'}. Fictional models are
        illustrative.
        {catalogueError ? ` ${catalogueError}` : ''}
        {[...loaded.values()].some((item) => item.error)
          ? ' A model could not be loaded; its measured box is shown.'
          : ''}
      </p>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        camera={{ near: 0.01, far: 200 }}
        onCreated={({ gl }) => {
          setCanvasReady(true);
          gl.domElement.addEventListener('webglcontextlost', () => setCanvasReady(false));
          gl.domElement.addEventListener('webglcontextrestored', () => setCanvasReady(true));
        }}
      >
        <CalibratedCamera pose={pose} />
        <ambientLight intensity={1.8} />
        <directionalLight position={[3, 7, 5]} intensity={3} />
        {scene.objects.map((object) => {
          const resolution = resolutions.get(object.id),
            model = resolution?.kind === 'model' ? loaded.get(resolution.asset.id)?.model : undefined;
          return (
            <group
              key={object.id}
              onPointerDown={(event) => {
                event.stopPropagation();
                onStart(object, event.nativeEvent, event.point.y);
              }}
            >
              <Furniture3D
                object={object}
                model={model}
                selected={selectedId === object.id}
                changed={false}
                onSelect={select}
              />
            </group>
          );
        })}
      </Canvas>
    </>
  );
}
export default function PhotoStudio({
  projectId,
  readOnly,
  onStatusChange,
  refreshKey = 0,
  placementRequest,
}: {
  projectId: string;
  readOnly: boolean;
  onStatusChange?: (status: PhotoConsultationStatus) => void;
  refreshKey?: number;
  placementRequest?: PhotoPlacementRequest | null;
}) {
  const { scene, proposal, busy, preview, select, selectedId, endpoint } = useEditor();
  const current = endpoint === `/api/projects/${projectId}/scene` ? scene : null;
  const [references, setReferences] = useState<Reference[]>([]),
    [referenceId, setReferenceId] = useState(''),
    [workspace, setWorkspace] = useState<PhotoWorkspace | null>(null),
    [points, setPoints] = useState<PhotoPoint[]>([]),
    [editing, setEditing] = useState(false),
    [loadedImage, setLoadedImage] = useState({ key: '', width: 0, height: 0 }),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [before, setBefore] = useState(false),
    [live, setLive] = useState<Scene | null>(null),
    [armed, setArmed] = useState<string | null>(null),
    [showDetectedAreas, setShowDetectedAreas] = useState(true),
    [rendering, setRendering] = useState<PhotoRenderStatus | null>(null),
    [photoToolsPending, setPhotoToolsPending] = useState(false),
    [pendingPlacement, setPendingPlacement] = useState<PhotoPlacementRequest | null>(null);
  const [floor, setFloor] = useState({ x: 0, z: 0, width: 1, depth: 1 }),
    [catalogue, setCatalogue] = useState<CatalogueProduct[]>([]),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [currency, setCurrency] = useState(''),
    [catalogueLoading, setCatalogueLoading] = useState(false),
    [loadedCatalogueKey, setLoadedCatalogueKey] = useState('');
  const lastPlacementRequest = useRef('');
  const renderStatusChange = useCallback((value: PhotoRenderStatus) => {
    setRendering((old) => (JSON.stringify(old) === JSON.stringify(value) ? old : value));
  }, []);
  const stage = useRef<HTMLDivElement>(null),
    drag = useRef<{
      object: SceneObject;
      start: { x: number; z: number };
      operation: Operation | null;
      source: Scene;
      height: number;
    } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void accountRequest<{ currency: string }>(`/api/projects/${projectId}`, { signal: controller.signal })
      .then((p) => setCurrency(p.currency))
      .catch(() => {});
    return () => controller.abort();
  }, [projectId]);
  const activeReference = useRef(referenceId);
  activeReference.current = referenceId;
  const loadReferences = useCallback(async () => {
    const values = await accountRequest<Reference[]>(`/api/projects/${projectId}/references`);
    setReferences(values);
    setReferenceId((old) =>
      values.some((r) => r.id === old)
        ? old
        : ((new URLSearchParams(window.location.search).get('photo') === 'synthetic'
            ? values.find((r) => r.name === 'Boreal Living — synthetic measurement demonstration.png')?.id
            : undefined) ??
          values[0]?.id ??
          ''),
    );
  }, [projectId]);
  useEffect(() => {
    void loadReferences().catch(() => setError('Room photographs could not be loaded.'));
  }, [loadReferences]);
  useEffect(() => {
    setWorkspace(null);
    setBefore(false);
    setSaving(false);
    setArmed(null);
    drag.current = null;
    setPoints([]);
    setLive(null);
    if (!referenceId) return;
    const controller = new AbortController();
    void accountRequest<PhotoWorkspace>(`/api/projects/${projectId}/photos/${referenceId}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        setWorkspace(value);
        setPoints(value.calibration?.points ?? []);
        setFloor(
          value.calibration?.floor ?? {
            x: 0,
            z: 0,
            width: current?.room.width ?? 1,
            depth: current?.room.depth ?? 1,
          },
        );
        setEditing(!value.calibration);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Photograph setup could not be loaded.');
      });
    return () => controller.abort();
  }, [projectId, referenceId, refreshKey]); // Scene changes must not reset unsaved calibration points.
  const catalogueKey = `${current?.organisationId ?? ''}:${offset}:${search}`;
  useEffect(() => {
    if (readOnly || !current?.organisationId) return;
    const controller = new AbortController();
    setCatalogueLoading(true);
    void accountRequest<CatalogueProduct[]>(
      `/api/organisations/${current?.organisationId}/catalogue?${new URLSearchParams({ offset: String(offset), ...(search ? { q: search } : {}) })}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setCatalogue(value);
          setLoadedCatalogueKey(catalogueKey);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCatalogue([]);
          setLoadedCatalogueKey(catalogueKey);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogueLoading(false);
      });
    return () => controller.abort();
  }, [current?.organisationId, readOnly, search, offset, catalogueKey]);
  const presentedRoom = proposal?.scene.room ?? current?.room;
  const pose = useMemo(() => {
    if (
      workspace?.referenceId !== referenceId ||
      !workspace?.calibration ||
      !current ||
      workspace.calibration.roomWidth !== presentedRoom?.width ||
      workspace.calibration.roomDepth !== presentedRoom?.depth ||
      !presentedRoom?.measurementsConfirmed
    )
      return null;
    try {
      const camera = calibratePhoto(workspace.calibration);
      return camera.position[1] <= presentedRoom.height ? camera : null;
    } catch {
      return null;
    }
  }, [workspace?.calibration, workspace?.referenceId, referenceId, current, presentedRoom]);
  const reference = references.find((r) => r.id === referenceId),
    shown = live ?? proposal?.scene ?? current;
  const imageSource = reference
    ? before
      ? reference.url
      : workspace?.referenceId === referenceId && workspace.backgroundReferenceId
        ? `/api/projects/${projectId}/references/${workspace.backgroundReferenceId}`
        : reference.url
    : '';
  const imageKey = `${referenceId}:${refreshKey}:${imageSource}`;
  const imageSize = loadedImage.key === imageKey ? loadedImage : { width: 0, height: 0 };
  const available = (loadedCatalogueKey === catalogueKey ? catalogue : [])
    .flatMap((product) => product.variants.map((variant) => ({ product, variant })))
    .filter(
      ({ product, variant }) =>
        product.currency === currency && isCatalogueVariantAvailable(product, variant),
    );
  useEffect(() => {
    if (!placementRequest || readOnly || placementRequest.requestId === lastPlacementRequest.current) return;
    lastPlacementRequest.current = placementRequest.requestId;
    setPendingPlacement(placementRequest);
    setArmed(null);
    setQuery(placementRequest.sku);
    setSearch(placementRequest.sku);
    setOffset(0);
    setError('');
  }, [placementRequest, readOnly]);
  useEffect(() => {
    if (!pendingPlacement || !currency || catalogueLoading || loadedCatalogueKey !== catalogueKey) return;
    if (search !== pendingPlacement.sku || offset !== 0) return;
    const entry = available.find(
      ({ variant }) => variant.id === pendingPlacement.variantId && variant.sku === pendingPlacement.sku,
    );
    if (entry) setArmed(entry.variant.id);
    else setError('This recommended product is not currently available in the project’s store inventory.');
    setPendingPlacement(null);
  }, [
    pendingPlacement,
    currency,
    catalogueLoading,
    loadedCatalogueKey,
    catalogueKey,
    search,
    offset,
    available,
  ]);
  const calibrated = Boolean(pose) && !editing;
  const imageReady = Boolean(
    workspace?.referenceId === referenceId &&
    imageSize.width &&
    !saving &&
    !before &&
    !editing &&
    !armed &&
    !pendingPlacement &&
    !photoToolsPending &&
    (!pose || (rendering?.sceneId === shown?.id && rendering?.canvasReady)) &&
    !live,
  );
  useEffect(() => {
    onStatusChange?.({
      referenceId: referenceId || null,
      photoRevision: workspace?.referenceId === referenceId ? workspace.revision : 0,
      calibrated,
      imageReady,
    });
  }, [onStatusChange, referenceId, workspace?.referenceId, workspace?.revision, calibrated, imageReady]);
  useEffect(
    () => () =>
      onStatusChange?.({ referenceId: null, photoRevision: 0, calibrated: false, imageReady: false }),
    [onStatusChange],
  );
  const locked =
    readOnly || busy || Boolean(proposal) || saving || before || editing || !pose || !imageSize.width;
  function point(event: { clientX: number; clientY: number }): PhotoPoint {
    const box = stage.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  }
  async function save(update: Partial<PhotoWorkspace>) {
    if (!workspace || workspace.referenceId !== referenceId) return;
    setSaving(true);
    setError('');
    try {
      const value = await accountRequest<PhotoWorkspace>(`/api/projects/${projectId}/photos/${referenceId}`, {
        method: 'PUT',
        body: {
          expectedRevision: workspace.revision,
          calibration: workspace.calibration,
          regions: workspace.regions,
          backgroundReferenceId: workspace.backgroundReferenceId,
          ...update,
        },
      });
      if (activeReference.current !== referenceId) return;
      setWorkspace(value);
      return value;
    } catch (reason) {
      if (activeReference.current === referenceId)
        setError(reason instanceof Error ? reason.message : 'Photo setup could not be saved.');
    } finally {
      if (activeReference.current === referenceId) setSaving(false);
    }
  }
  async function stageOperation(operation: Operation) {
    if (!current) return;
    setError('');
    const checked = propose(current, operation);
    if (!checked.ok) {
      setError(checked.conflicts[0]?.message ?? 'Furniture cannot be placed here.');
      return;
    }
    setLive(checked.scene);
    await preview(operation);
    setLive(null);
  }
  async function place(variantId: string, at: PhotoPoint) {
    if (locked || !pose || !current) return;
    const entry = available.find((value) => value.variant.id === variantId);
    if (!entry) return;
    const { variant, product } = entry;
    let p;
    try {
      p = photoPointToFloor(pose, at);
    } catch {
      setError('Choose a visible floor position below the horizon.');
      return;
    }
    const object: SceneObject = {
      id: crypto.randomUUID(),
      variantId: variant.id,
      sku: variant.sku,
      name: product.name,
      category: product.category,
      dimensions: variant.dimensions,
      color: variant.color,
      solid: product.category !== 'rug',
      locks: { position: false, rotation: false, product: false },
      transform: { x: p.x, y: 0, z: p.z, rotation: 0 },
    };
    setArmed(null);
    select(object.id);
    await stageOperation({ type: 'add-object', object });
  }
  function start(object: SceneObject, event: globalThis.PointerEvent, height: number) {
    select(object.id);
    if (locked || object.locks.position || !pose || !current) return;
    const dragHeight = Math.max(0, Math.min(height, pose.position[1] - 0.02));
    let start;
    try {
      start = photoPointToPlane(pose, point(event), dragHeight);
    } catch {
      setError('Grab a visible part of the furniture below camera height.');
      return;
    }
    event.preventDefault();
    stage.current?.setPointerCapture(event.pointerId);
    drag.current = { object, start, height: dragHeight, operation: null, source: current };
  }
  function move(event: ReactPointerEvent) {
    const active = drag.current;
    if (!active || !pose) return;
    let p;
    try {
      p = photoPointToPlane(pose, point(event), active.height);
    } catch {
      active.operation = null;
      setLive(null);
      setError('Choose a visible room position below the horizon.');
      return;
    }
    const operation: Operation = {
      type: 'transform',
      objectId: active.object.id,
      mode: 'manual',
      transform: {
        ...active.object.transform,
        x: active.object.transform.x + p.x - active.start.x,
        z: active.object.transform.z + p.z - active.start.z,
      },
    };
    const result = propose(active.source, operation);
    if (result.ok) {
      active.operation = operation;
      setLive(result.scene);
      setError('');
    } else {
      active.operation = null;
      setLive(null);
      setError(result.conflicts[0]?.message ?? 'This position is blocked.');
    }
  }
  async function end() {
    const active = drag.current;
    drag.current = null;
    if (active?.operation) await preview(active.operation);
    setLive(null);
  }
  const selected = shown?.objects.find((object) => object.id === selectedId);
  return (
    <div
      className="photo-studio"
      data-testid="photo-studio"
      data-calibrated={calibrated}
      data-revision={current?.version}
      data-photo-revision={workspace?.referenceId === referenceId ? workspace.revision : undefined}
      data-scene-version={shown?.version}
      data-preview={Boolean(proposal || live)}
    >
      <div className="photo-intro">
        <strong>See furniture in your client's room</strong>
        <p>
          Upload a photo, review the visible objects, confirm measurements, then place store furniture in the
          photograph. Product dimensions stay in metres.
        </p>
      </div>
      {readOnly && (
        <p className="account-notice">
          View-only consultation. Review the saved photograph, furniture and issued quotations.
        </p>
      )}
      {!readOnly && (
        <a className="business-text-link" href="#project-design-assistant">
          Get inventory suggestions with Design assistance — select this photograph and your brief
        </a>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <div className="photo-top-tools">
        <Field label="Client room photograph">
          <select
            aria-label="Client room photograph"
            disabled={saving || busy || Boolean(proposal)}
            value={referenceId}
            onChange={(event) => {
              setReferenceId(event.target.value);
              setError('');
            }}
          >
            {references.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        {!readOnly && (
          <label className="button button-secondary">
            Upload photo
            <input
              aria-label="Upload client room photograph"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setSaving(true);
                try {
                  const data = new FormData();
                  data.set('file', file);
                  const response = await fetch(`/api/projects/${projectId}/references`, {
                    method: 'POST',
                    body: data,
                  });
                  if (!response.ok) throw new Error((await response.json()).error || 'Photo upload failed.');
                  const created = await response.json();
                  await loadReferences();
                  setReferenceId(created.id);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Upload failed.');
                } finally {
                  setSaving(false);
                  event.target.value = '';
                }
              }}
            />
          </label>
        )}
        {pose && (
          <Button disabled={saving} onClick={() => setBefore((value) => !value)}>
            {before ? 'Show proposed furniture' : 'Show original photo'}
          </Button>
        )}
        {workspace?.regions.length ? (
          <Button aria-pressed={showDetectedAreas} onClick={() => setShowDetectedAreas((value) => !value)}>
            {showDetectedAreas ? 'Hide detected areas' : 'Show detected areas'}
          </Button>
        ) : null}
        {workspace && !readOnly && (
          <Button
            disabled={busy || saving}
            onClick={() => {
              setEditing((value) => !value);
              setPoints(workspace.calibration?.points ?? []);
            }}
          >
            {editing ? 'Close calibration' : 'Adjust photo calibration'}
          </Button>
        )}
      </div>
      {reference && (
        <div
          ref={stage}
          className="photo-stage"
          style={{ aspectRatio: imageSize.width ? `${imageSize.width}/${imageSize.height}` : '3/2' }}
          onPointerMove={move}
          onPointerUp={() => void end()}
          onPointerCancel={() => {
            drag.current = null;
            setLive(null);
          }}
          onDragOver={(event) => {
            if (!locked) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData('application/x-roomsell-variant');
            if (id) void place(id, point(event));
          }}
          onPointerDown={(event) => {
            if (editing && !readOnly && imageSize.width && points.length < 4)
              setPoints((old) => [...old, point(event)]);
            else if (armed) void place(armed, point(event));
          }}
        >
          <img
            key={imageKey}
            src={imageSource}
            alt="Client room photograph"
            draggable={false}
            onLoad={(event) => {
              if (activeReference.current !== referenceId) return;
              setLoadedImage({
                key: imageKey,
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
            onError={() => {
              if (activeReference.current !== referenceId) return;
              setLoadedImage({ key: '', width: 0, height: 0 });
              setError(
                'The room photograph could not be displayed. Retry the photograph before presenting it.',
              );
            }}
          />
          {pose && shown && !before && !editing && (
            <div className="photo-model-layer">
              <ViewerBoundary
                fallback={
                  <p role="status">
                    Photo furniture rendering requires WebGL. Enable browser hardware acceleration or use a
                    supported browser to view the furniture in this photograph. Your saved design is
                    preserved.
                  </p>
                }
              >
                <PhotoFurniture
                  projectId={projectId}
                  scene={shown}
                  pose={pose}
                  onStart={start}
                  onRenderStatusChange={renderStatusChange}
                />
              </ViewerBoundary>
            </div>
          )}
          {!before &&
            !editing &&
            showDetectedAreas &&
            workspace?.regions.map((r, i) => (
              <div
                key={r.id}
                className="photo-region-label"
                style={{
                  left: `${r.bounds.x * 100}%`,
                  top: `${r.bounds.y * 100}%`,
                  width: `${r.bounds.width * 100}%`,
                  height: `${r.bounds.height * 100}%`,
                }}
              >
                {i + 1}. {r.label} · {r.disposition}
              </div>
            ))}
          {!before &&
            !editing &&
            workspace?.regions
              .filter((r) => r.disposition === 'keep' && r.foreground)
              .map((r) => (
                <img
                  key={r.id}
                  className="photo-foreground"
                  src={reference.url}
                  alt={`Foreground area: ${r.label}`}
                  draggable={false}
                  style={{
                    clipPath: `inset(${r.bounds.y * 100}% ${(1 - r.bounds.x - r.bounds.width) * 100}% ${(1 - r.bounds.y - r.bounds.height) * 100}% ${r.bounds.x * 100}%)`,
                  }}
                />
              ))}
          {editing && (
            <svg className="photo-marker-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              {points.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x * 1000} cy={p.y * 1000} r="9" />
                  <text x={p.x * 1000 + 12} y={p.y * 1000 - 10}>
                    {i + 1}
                  </text>
                </g>
              ))}
              {points.length === 4 && (
                <polygon
                  points={points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                  fill="none"
                  stroke="#ebad36"
                  strokeWidth="3"
                />
              )}
            </svg>
          )}
        </div>
      )}
      {!reference && <p className="account-notice">Upload the client's room photograph to begin.</p>}
      {workspace?.referenceId === referenceId && reference && (
        <PhotoPhotoTools
          key={referenceId}
          projectId={projectId}
          workspace={workspace}
          readOnly={readOnly}
          save={save}
          onError={setError}
          imageSize={imageSize}
          workspaceSaving={saving}
          onPendingChange={setPhotoToolsPending}
        />
      )}
      {editing && workspace?.referenceId === referenceId && (
        <div className="photo-calibration">
          <h3>Match a measured rectangle on the floor</h3>
          <p>
            Click clockwise: 1 origin corner, 2 along room width, 3 opposite corner, 4 along depth. Use four
            coplanar floor points whose real distances you know. The rectangle can cover part of the room.
          </p>
          <div className="photo-fields">
            {(['x', 'z', 'width', 'depth'] as const).map((name) => (
              <Field key={name} label={`Floor rectangle ${name} (m)`}>
                <input
                  aria-label={`Floor rectangle ${name} (m)`}
                  type="number"
                  step="0.01"
                  min={name === 'x' || name === 'z' ? 0 : 0.2}
                  value={floor[name]}
                  onChange={(event) => setFloor({ ...floor, [name]: Number(event.target.value) })}
                />
              </Field>
            ))}
          </div>
          <p>
            {points.length}/4 points marked. Room: {current?.room.width} × {current?.room.depth} m.{' '}
            {current?.room.measurementsConfirmed
              ? 'Measurements confirmed.'
              : 'Confirm room measurements in Room essentials first.'}
          </p>
          <Button onClick={() => setPoints([])}>Reset floor points</Button>
          <Button
            variant="primary"
            disabled={
              points.length !== 4 || !imageSize.width || saving || !current?.room.measurementsConfirmed
            }
            onClick={async () => {
              if (!current) return;
              const calibration: PhotoCalibration = {
                version: 1,
                imageWidth: imageSize.width,
                imageHeight: imageSize.height,
                roomWidth: current.room.width,
                roomDepth: current.room.depth,
                floor,
                points: points as PhotoCalibration['points'],
              };
              try {
                calibratePhoto(calibration);
                if (await save({ calibration })) setEditing(false);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Check the floor points.');
              }
            }}
          >
            Save photo calibration
          </Button>
        </div>
      )}
      {workspace?.calibration && !pose && !editing && (
        <p role="status" className="account-notice">
          The current room measurements do not match this photo calibration. Confirm measurements and choose
          Adjust photo calibration.
        </p>
      )}
      {pose && !editing && (
        <p className="photo-scale" role="status">
          Measured photo view · camera height {pose.position[1].toFixed(2)} m · alignment error{' '}
          {(pose.reprojectionError * 100).toFixed(2)}%. Catalogue dimensions are unchanged; check floor
          alignment before presenting fit.
        </p>
      )}
      {pose && !editing && (
        <>
          <div className="photo-selection" aria-label="Photo furniture">
            {shown?.objects.map((object) => (
              <button
                key={object.id}
                type="button"
                data-testid={`photo-object-${object.id}`}
                data-x={object.transform.x}
                data-z={object.transform.z}
                data-yaw={object.transform.rotation}
                data-render-kind={
                  rendering?.sceneId === shown?.id ? (rendering.objects[object.id]?.kind ?? 'proxy') : 'proxy'
                }
                data-asset-id={
                  rendering?.sceneId === shown?.id ? rendering.objects[object.id]?.assetId : undefined
                }
                aria-pressed={object.id === selectedId}
                onClick={() => select(object.id)}
              >
                {object.name} · {object.dimensions.width} × {object.dimensions.depth} ×{' '}
                {object.dimensions.height} m{object.locks.position ? ' · position locked' : ''}
              </button>
            ))}
          </div>
          {selected && (
            <div className="photo-actions">
              <strong>{selected.name}</strong>
              <Button
                disabled={locked || selected.locks.rotation}
                onClick={() =>
                  void stageOperation({
                    type: 'transform',
                    objectId: selected.id,
                    mode: 'manual',
                    transform: {
                      ...selected.transform,
                      rotation: Math.atan2(
                        Math.sin(selected.transform.rotation + Math.PI / 2),
                        Math.cos(selected.transform.rotation + Math.PI / 2),
                      ),
                    },
                  })
                }
              >
                Rotate selected furniture
              </Button>
              <Button
                disabled={locked || selected.locks.product}
                onClick={() => void stageOperation({ type: 'remove-object', objectId: selected.id })}
              >
                Remove selected furniture
              </Button>
            </div>
          )}
          {!readOnly && (
            <div className="photo-inventory">
              <h3>Store inventory</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(query.trim());
                  setOffset(0);
                }}
              >
                <input
                  aria-label="Search photo inventory"
                  placeholder="Search store inventory"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Button type="submit">Search products</Button>
              </form>
              <p>
                Drag an item onto the photograph, or choose Place then click its floor position. Review and
                accept the checked placement to save.
              </p>
              <div className="photo-products">
                {available.map(({ product, variant }) => {
                  const image =
                    product.assets.find(
                      (asset) => asset.kind === 'image' && asset.variantId === variant.id,
                    ) ?? product.assets.find((asset) => asset.kind === 'image' && !asset.variantId);
                  const imageUrl =
                    image && current?.organisationId
                      ? `/api/organisations/${current.organisationId}/catalogue/${product.id}/assets/${image.id}`
                      : null;
                  return (
                    <article
                      draggable={!locked}
                      key={variant.id}
                      onDragStart={(event) =>
                        event.dataTransfer.setData('application/x-roomsell-variant', variant.id)
                      }
                    >
                      {imageUrl && (
                        <img
                          className="photo-catalogue-image"
                          src={imageUrl}
                          alt={product.name}
                          loading="lazy"
                          draggable={false}
                        />
                      )}
                      <strong>{product.name}</strong>
                      <small>
                        {variant.sku} · {variant.dimensions.width} × {variant.dimensions.depth} ×{' '}
                        {variant.dimensions.height} m
                      </small>
                      <span>{formatMoney(variant.priceMinor, product.currency)}</span>
                      <Button
                        disabled={locked}
                        aria-pressed={armed === variant.id}
                        onClick={() => {
                          setPendingPlacement(null);
                          setArmed(variant.id);
                        }}
                      >
                        Place {product.name}
                      </Button>
                    </article>
                  );
                })}
              </div>
              {catalogueLoading && <p role="status">Loading store inventory…</p>}
              {!catalogueLoading && !available.length && (
                <p>No available products match this search and project currency.</p>
              )}
              {(armed || pendingPlacement) && (
                <div className="photo-placement-notice">
                  <p role="status">
                    {armed
                      ? "Click the furniture's floor position in the photograph."
                      : 'Finding the recommended product in store inventory…'}
                  </p>
                  <Button
                    onClick={() => {
                      setArmed(null);
                      setPendingPlacement(null);
                    }}
                  >
                    Cancel placement
                  </Button>
                </div>
              )}
              <Button
                disabled={catalogueLoading || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                Previous products
              </Button>
              <Button
                disabled={catalogueLoading || catalogue.length < 25}
                onClick={() => setOffset(offset + 25)}
              >
                Next products
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
