'use client';
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Maximize, Minus, Plus } from 'lucide-react';
import { Button } from '@roomsell/ui';
import {
  resolveObjectModel,
  type ProjectCatalogueAsset,
  type SelectedProjectProducts,
} from '@roomsell/catalogue';
import { openingZones, sceneObjectTransform } from '@roomsell/geometry';
import type { Room, Scene, SceneObject } from '@roomsell/scene-core';
import { useEditor } from '../lib/editor-store';
import { disposeRoomModel, loadRoomModel, type LoadedRoomModel } from '../lib/3d-model-runtime';
import './room-viewer-3d.css';

type ModelResolution = ReturnType<typeof resolveObjectModel>;
type ModelState = { model?: LoadedRoomModel; error?: string };
type CameraCommand = { kind: 'reset' | 'in' | 'out'; sequence: number };

// Bound one viewport as well as each uploaded asset. Exceeding a limit keeps the exact dimension proxy.
const VIEWPORT_LIMITS = {
  uniqueModels: 12,
  bytes: 100 * 1024 * 1024,
  triangles: 400_000,
  vertices: 1_000_000,
  textures: 64,
  texturePixels: 32_000_000,
};
function nonnegativeMetric(asset: ProjectCatalogueAsset, key: string): number {
  const value = asset.validation[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : Infinity;
}
function boundedResolutions(
  scene: Scene,
  selected: SelectedProjectProducts | null,
): Map<string, ModelResolution> {
  const resolutions = new Map<string, ModelResolution>();
  const seen = new Set<string>();
  let bytes = 0;
  let triangles = 0;
  let vertices = 0;
  let textures = 0;
  let texturePixels = 0;
  for (const object of scene.objects) {
    const item = selected?.items.find(
      (candidate) => candidate.objectId === object.id && candidate.variantId === object.variantId,
    );
    const choice = resolveObjectModel(object, item?.assets ?? []);
    if (choice.kind === 'proxy') {
      resolutions.set(object.id, choice);
      continue;
    }
    const { asset } = choice;
    const unique = !seen.has(asset.id);
    const assetBytes =
      Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 ? asset.sizeBytes : Infinity;
    const nextBytes = bytes + (unique ? assetBytes : 0);
    const nextTextures = textures + (unique ? nonnegativeMetric(asset, 'textures') : 0);
    const nextPixels = texturePixels + (unique ? nonnegativeMetric(asset, 'texturePixels') : 0);
    const nextTriangles = triangles + nonnegativeMetric(asset, 'triangles');
    const nextVertices = vertices + nonnegativeMetric(asset, 'vertices');
    if (
      (unique && seen.size >= VIEWPORT_LIMITS.uniqueModels) ||
      nextBytes > VIEWPORT_LIMITS.bytes ||
      nextTriangles > VIEWPORT_LIMITS.triangles ||
      nextVertices > VIEWPORT_LIMITS.vertices ||
      nextTextures > VIEWPORT_LIMITS.textures ||
      nextPixels > VIEWPORT_LIMITS.texturePixels
    ) {
      resolutions.set(object.id, {
        kind: 'proxy',
        reason: 'The viewer resource limit was reached. Exact catalogue dimensions are shown.',
      });
      continue;
    }
    bytes = nextBytes;
    triangles = nextTriangles;
    vertices = nextVertices;
    textures = nextTextures;
    texturePixels = nextPixels;
    seen.add(asset.id);
    resolutions.set(object.id, choice);
  }
  return resolutions;
}

function useProjectModels(
  projectId: string | undefined,
  scene: Scene,
  refresh: number,
  productsEndpoint?: string,
) {
  const [catalogue, setCatalogue] = useState<{ projectId: string; products: SelectedProjectProducts } | null>(
    null,
  );
  const [catalogueError, setCatalogueError] = useState('');
  const [loaded, setLoaded] = useState<Map<string, ModelState>>(new Map());
  const savedVersion = useEditor((state) => state.scene?.version);
  useEffect(() => {
    setCatalogue(null);
    setCatalogueError('');
    if (!projectId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          productsEndpoint ?? `/api/projects/${encodeURIComponent(projectId)}/products`,
          {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'same-origin',
            redirect: 'error',
          },
        );
        if (!response.ok)
          throw new Error('Selected model assets could not be verified. Exact dimension proxies are shown.');
        const products = (await response.json()) as SelectedProjectProducts;
        if (!Array.isArray(products.items))
          throw new Error('Selected model metadata is invalid. Exact dimension proxies are shown.');
        if (!controller.signal.aborted) setCatalogue({ projectId, products });
      } catch (error) {
        if (!controller.signal.aborted)
          setCatalogueError(
            error instanceof Error ? error.message : 'Selected models could not be verified.',
          );
      }
    })();
    return () => controller.abort();
  }, [projectId, savedVersion, scene.id, refresh, productsEndpoint]);
  const products = catalogue && catalogue.projectId === projectId ? catalogue.products : null;
  const resolutions = useMemo(() => boundedResolutions(scene, products), [scene, products]);
  const requests = new Map<string, { asset: ProjectCatalogueAsset; dimensions: SceneObject['dimensions'] }>();
  for (const object of scene.objects) {
    const resolution = resolutions.get(object.id);
    if (resolution?.kind === 'model')
      requests.set(resolution.asset.id, { asset: resolution.asset, dimensions: object.dimensions });
  }
  const signature = JSON.stringify(
    [...requests.values()].map(({ asset, dimensions }) => [asset.id, dimensions, asset.url]),
  );
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  useEffect(() => {
    setLoaded(new Map());
    if (!projectId) return;
    const controller = new AbortController();
    const owned = new Set<LoadedRoomModel>();
    const queue = [...requestsRef.current.values()];
    let index = 0;
    const next = async () => {
      while (!controller.signal.aborted && index < queue.length) {
        const request = queue[index++];
        try {
          const model = await loadRoomModel(projectId, request.asset, request.dimensions, controller.signal);
          if (controller.signal.aborted) {
            disposeRoomModel(model.scene);
            return;
          }
          owned.add(model);
          setLoaded((old) => new Map(old).set(request.asset.id, { model }));
        } catch (error) {
          if (!controller.signal.aborted)
            setLoaded((old) =>
              new Map(old).set(request.asset.id, {
                error:
                  error instanceof Error
                    ? error.message
                    : 'Model decoding failed. Exact dimensions are shown.',
              }),
            );
        }
      }
    };
    for (let worker = 0; worker < Math.min(3, queue.length); worker++) void next();
    return () => {
      controller.abort();
      for (const model of owned) disposeRoomModel(model.scene);
    };
  }, [projectId, signature]);
  return { resolutions, loaded, catalogueError };
}

function CameraRig({ room, command }: { room: Room; command: CameraCommand }) {
  const { camera, gl, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.12;
    orbit.minDistance = 0.5;
    orbit.maxDistance = 100;
    orbit.minPolarAngle = 0.08;
    orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    const changed = () => invalidate();
    orbit.addEventListener('change', changed);
    controls.current = orbit;
    return () => {
      orbit.removeEventListener('change', changed);
      orbit.dispose();
      controls.current = null;
    };
  }, [camera, gl, invalidate]);
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const centre = new Vector3(room.width / 2, 0.3, room.depth / 2);
    if (command.kind === 'reset' || command.sequence === 0) {
      const span = Math.max(room.width, room.depth);
      orbit.target.copy(centre);
      camera.position.set(
        centre.x + span * 0.8,
        Math.max(room.height * 1.8, span * 0.85),
        centre.z + span * 0.9,
      );
      if (camera instanceof PerspectiveCamera) {
        camera.near = 0.01;
        camera.far = 200;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(centre);
      orbit.saveState();
    } else {
      const offset = camera.position.clone().sub(orbit.target);
      offset.multiplyScalar(command.kind === 'in' ? 0.8 : 1.25);
      offset.clampLength(orbit.minDistance, orbit.maxDistance);
      camera.position.copy(orbit.target).add(offset);
    }
    orbit.update();
    invalidate();
  }, [camera, command, invalidate, room.width, room.depth, room.height]);
  useFrame(() => {
    if (controls.current?.update()) invalidate();
  });
  return null;
}

type WallSegment = { position: [number, number, number]; size: [number, number, number]; key: string };
function wallSegments(room: Room, fullWalls: boolean): WallSegment[] {
  const segments: WallSegment[] = [];
  const thickness = 0.08;
  for (const wall of ['north', 'east', 'south', 'west'] as const) {
    const horizontal = wall === 'north' || wall === 'south';
    const length = horizontal ? room.width : room.depth;
    const height = !fullWalls && (wall === 'east' || wall === 'south') ? 0.12 : room.height;
    const add = (start: number, width: number, bottom: number, top: number, label: string) => {
      const clippedTop = Math.min(top, height);
      if (width <= 0 || bottom >= clippedTop) return;
      const along = start + width / 2;
      const across =
        wall === 'north' || wall === 'west'
          ? -thickness / 2
          : (horizontal ? room.depth : room.width) + thickness / 2;
      segments.push({
        key: `${wall}-${label}`,
        position: horizontal
          ? [along, (bottom + clippedTop) / 2, across]
          : [across, (bottom + clippedTop) / 2, along],
        size: horizontal ? [width, clippedTop - bottom, thickness] : [thickness, clippedTop - bottom, width],
      });
    };
    let offset = 0;
    for (const opening of room.openings
      .filter((item) => item.wall === wall)
      .sort((a, b) => a.offset - b.offset)) {
      add(offset, opening.offset - offset, 0, height, `before-${opening.id}`);
      add(opening.offset, opening.width, 0, opening.sillHeight, `below-${opening.id}`);
      add(opening.offset, opening.width, opening.sillHeight + opening.height, height, `above-${opening.id}`);
      offset = Math.max(offset, opening.offset + opening.width);
    }
    add(offset, length - offset, 0, height, 'end');
  }
  return segments;
}
function RoomArchitecture({ room, fullWalls }: { room: Room; fullWalls: boolean }) {
  const segments = useMemo(() => wallSegments(room, fullWalls), [room, fullWalls]);
  return (
    <group>
      <mesh position={[room.width / 2, -0.025, room.depth / 2]} receiveShadow>
        <boxGeometry args={[room.width, 0.05, room.depth]} />
        <meshStandardMaterial color="#eae5d8" roughness={0.96} />
      </mesh>
      {segments.map((segment) => (
        <mesh key={segment.key} position={segment.position}>
          <boxGeometry args={segment.size} />
          <meshStandardMaterial color="#f6f3ea" roughness={0.9} />
        </mesh>
      ))}
      {[...room.zones, ...openingZones(room)].map((zone) => (
        <mesh
          key={zone.id}
          position={[zone.x + zone.width / 2, 0.004, zone.z + zone.depth / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[zone.width, zone.depth]} />
          <meshBasicMaterial
            color={zone.kind === 'obstacle' ? '#877765' : zone.kind === 'circulation' ? '#72b3a2' : '#d7a13c'}
            transparent
            opacity={0.24}
            depthWrite={false}
          />
        </mesh>
      ))}
      {room.openings
        .filter((opening) => opening.kind === 'window')
        .map((opening) => {
          const horizontal = opening.wall === 'north' || opening.wall === 'south';
          const position: [number, number, number] = horizontal
            ? [
                opening.offset + opening.width / 2,
                opening.sillHeight + opening.height / 2,
                opening.wall === 'north' ? -0.01 : room.depth + 0.01,
              ]
            : [
                opening.wall === 'west' ? -0.01 : room.width + 0.01,
                opening.sillHeight + opening.height / 2,
                opening.offset + opening.width / 2,
              ];
          return (
            <mesh
              key={opening.id}
              position={position}
              rotation={horizontal ? [0, 0, 0] : [0, Math.PI / 2, 0]}
            >
              <planeGeometry args={[opening.width, opening.height]} />
              <meshBasicMaterial color="#a8d5df" transparent opacity={0.32} side={2} depthWrite={false} />
            </mesh>
          );
        })}
    </group>
  );
}

function ObjectOutline({
  object,
  color,
  opacity = 1,
}: {
  object: SceneObject;
  color: string;
  opacity?: number;
}) {
  const edges = useMemo(() => {
    const box = new BoxGeometry(object.dimensions.width, object.dimensions.height, object.dimensions.depth);
    const edges = new EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [object.dimensions.width, object.dimensions.height, object.dimensions.depth]);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <lineSegments geometry={edges} position={[0, object.dimensions.height / 2, 0]}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
    </lineSegments>
  );
}
function Furniture3D({
  object,
  model,
  selected,
  changed,
  onSelect,
}: {
  object: SceneObject;
  model?: LoadedRoomModel;
  selected: boolean;
  changed: boolean;
  onSelect: (id: string) => void;
}) {
  const transform = sceneObjectTransform(object);
  const instance = useMemo(() => model?.scene.clone(true), [model]);
  const choose = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(object.id);
  };
  return (
    <group
      position={transform.position}
      rotation={[0, transform.rotationY, 0]}
      scale={transform.scale}
      onClick={choose}
      userData={{ objectId: object.id, variantId: object.variantId, dimensionProxy: !model }}
    >
      {model && instance ? (
        <group position={model.originOffset} dispose={null}>
          <primitive object={instance} dispose={null} />
        </group>
      ) : (
        <mesh position={[0, object.dimensions.height / 2, 0]}>
          <boxGeometry args={[object.dimensions.width, object.dimensions.height, object.dimensions.depth]} />
          <meshStandardMaterial
            color={object.color}
            roughness={0.84}
            transparent={object.category === 'rug'}
            opacity={object.category === 'rug' ? 0.74 : 1}
          />
        </mesh>
      )}
      {(selected || changed) && <ObjectOutline object={object} color={selected ? '#24564b' : '#e5a33b'} />}
    </group>
  );
}
function Comparison3D({ scene }: { scene: Scene }) {
  return (
    <group>
      {scene.objects.map((object) => {
        const transform = sceneObjectTransform(object);
        return (
          <group key={object.id} position={transform.position} rotation={[0, transform.rotationY, 0]}>
            <ObjectOutline object={object} color="#9569b5" opacity={0.6} />
          </group>
        );
      })}
    </group>
  );
}

function WebGLFallback({ onUnavailable }: { onUnavailable?: () => void }) {
  return (
    <div className="room-3d-fallback" role="status">
      <strong>3D is unavailable in this browser.</strong>
      <p>
        Your measured scene is preserved. Use the 2D floor plan to inspect and edit it, or enable browser
        WebGL support.
      </p>
      {onUnavailable && <Button onClick={onUnavailable}>Return to 2D floor plan</Button>}
    </div>
  );
}
class ViewerBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A derived, read-only renderer: selection/camera state can change; canonical objects cannot. */
export default function RoomViewer3D({
  projectId,
  sceneEndpoint,
  productsEndpoint,
  comparing = null,
  onUnavailable,
}: {
  projectId?: string;
  productsEndpoint?: string;
  sceneEndpoint?: string;
  comparing?: Scene | null;
  onUnavailable?: () => void;
}) {
  const { scene: saved, proposal, selectedId, select, endpoint } = useEditor();
  const scene = proposal?.scene ?? saved;
  const expectedEndpoint =
    sceneEndpoint ?? (projectId ? `/api/projects/${encodeURIComponent(projectId)}/scene` : '/api/scene');
  if (!scene || endpoint !== expectedEndpoint)
    return (
      <div className="canvas-loading" role="status">
        Loading measured 3D room…
      </div>
    );
  return (
    <MeasuredViewer
      key={`${expectedEndpoint}-${scene.id}`}
      scene={scene}
      comparing={comparing}
      projectId={projectId}
      productsEndpoint={productsEndpoint}
      selectedId={selectedId}
      onSelect={select}
      movedIds={proposal?.movedIds ?? []}
      preview={Boolean(proposal)}
      onUnavailable={onUnavailable}
    />
  );
}
function MeasuredViewer({
  scene,
  productsEndpoint,
  comparing,
  projectId,
  selectedId,
  onSelect,
  movedIds,
  preview,
  onUnavailable,
}: {
  scene: Scene;
  comparing: Scene | null;
  projectId?: string;
  productsEndpoint?: string;
  selectedId: string;
  onSelect: (id: string) => void;
  movedIds: string[];
  preview: boolean;
  onUnavailable?: () => void;
}) {
  const [modelRefresh, setModelRefresh] = useState(0);
  const { resolutions, loaded, catalogueError } = useProjectModels(
    projectId,
    scene,
    modelRefresh,
    productsEndpoint,
  );
  const [ready, setReady] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [fullWalls, setFullWalls] = useState(false);
  const [command, setCommand] = useState<CameraCommand>({ kind: 'reset', sequence: 0 });
  const cameraAction = (kind: CameraCommand['kind']) =>
    setCommand((old) => ({ kind, sequence: old.sequence + 1 }));
  const modelFor = (object: SceneObject) => {
    const resolution = resolutions.get(object.id);
    return resolution?.kind === 'model' ? loaded.get(resolution.asset.id) : undefined;
  };
  const selected = scene.objects.find((object) => object.id === selectedId);
  const modelCount = scene.objects.filter((object) => Boolean(modelFor(object)?.model)).length;
  const fallback = <WebGLFallback onUnavailable={onUnavailable} />;
  return (
    <div
      className="room-3d-viewer"
      role="region"
      aria-label="Measured 3D room viewer"
      data-testid="room-3d-viewer"
      data-ready={ready ? 'true' : 'false'}
      data-scene-version={scene.version}
      data-preview={preview ? 'true' : 'false'}
    >
      <div className="room-3d-controls">
        <span>Orbit: drag · Pan: right-drag/two fingers · Zoom: scroll/pinch</span>
        <label>
          <input
            type="checkbox"
            checked={fullWalls}
            onChange={(event) => setFullWalls(event.target.checked)}
          />{' '}
          Full-height walls
        </label>
        <Button variant="ghost" aria-label="Zoom in 3D" onClick={() => cameraAction('in')}>
          <Plus size={15} />
        </Button>
        <Button variant="ghost" aria-label="Zoom out 3D" onClick={() => cameraAction('out')}>
          <Minus size={15} />
        </Button>
        <Button variant="ghost" aria-label="Fit 3D room" onClick={() => cameraAction('reset')}>
          <Maximize size={15} />
        </Button>
        {projectId && (
          <Button variant="ghost" onClick={() => setModelRefresh((old) => old + 1)}>
            Refresh 3D models
          </Button>
        )}
      </div>
      {contextLost ? (
        fallback
      ) : (
        <ViewerBoundary fallback={fallback}>
          <div className="room-3d-canvas">
            <Canvas
              frameloop="demand"
              dpr={[1, 1.5]}
              camera={{ fov: 45, near: 0.01, far: 200 }}
              gl={{ antialias: true, powerPreference: 'low-power' }}
              fallback={fallback}
              onPointerMissed={() => onSelect('')}
              onCreated={({ gl }) => {
                gl.domElement.setAttribute('aria-label', 'Dimensionally accurate 3D room');
                gl.domElement.setAttribute('data-testid', 'room-3d-canvas');
                gl.domElement.addEventListener(
                  'webglcontextlost',
                  (event) => {
                    event.preventDefault();
                    setReady(false);
                    setContextLost(true);
                  },
                  { once: true },
                );
                setReady(true);
              }}
            >
              <color attach="background" args={['#f6f4ed']} />
              <ambientLight intensity={1.5} />
              <directionalLight position={[4, 10, 7]} intensity={2.1} />
              <CameraRig room={scene.room} command={command} />
              <RoomArchitecture room={scene.room} fullWalls={fullWalls} />
              {scene.objects.map((object) => (
                <Furniture3D
                  key={object.id}
                  object={object}
                  model={modelFor(object)?.model}
                  selected={selectedId === object.id}
                  changed={movedIds.includes(object.id)}
                  onSelect={onSelect}
                />
              ))}
              {comparing && <Comparison3D scene={comparing} />}
            </Canvas>
          </div>
        </ViewerBoundary>
      )}
      <div className="room-3d-status" aria-label="3D dimension and model status">
        <p>
          {preview ? 'Checked preview' : `Accepted revision ${scene.version}`} · {scene.room.width} ×{' '}
          {scene.room.depth} × {scene.room.height} m. Selection follows the 2D editor; move furniture with the
          placement controls.
        </p>
        <p>
          {modelCount} validated model{modelCount === 1 ? '' : 's'} · {scene.objects.length - modelCount}{' '}
          dimension prox{scene.objects.length - modelCount === 1 ? 'y' : 'ies'}. Models keep their validated
          size; proxies show saved outer dimensions.
        </p>
        {catalogueError && <p role="status">{catalogueError}</p>}
        {selected && (
          <p data-testid="room-3d-selected">
            Selected: {selected.name} · X {selected.transform.x} m · Z {selected.transform.z} m · yaw{' '}
            {selected.transform.rotation} rad · {selected.dimensions.width} × {selected.dimensions.depth} ×{' '}
            {selected.dimensions.height} m.
          </p>
        )}
        {comparing && <p>Purple outlines compare saved revision {comparing.version}.</p>}
        <div className="room-3d-objects" aria-label="3D furniture selection">
          {scene.objects.map((object) => {
            const resolution = resolutions.get(object.id);
            const state = modelFor(object);
            const label = state?.model
              ? 'Validated model, original size'
              : state?.error ||
                (resolution?.kind === 'proxy'
                  ? resolution.reason
                  : 'Loading validated model; exact dimension proxy shown.');
            return (
              <button
                type="button"
                className="room-3d-object"
                key={object.id}
                aria-label={`Select ${object.name} in 3D`}
                aria-pressed={object.id === selectedId}
                onClick={() => onSelect(object.id)}
                data-object-id={object.id}
                data-render-kind={state?.model ? 'model' : 'proxy'}
                data-x={object.transform.x}
                data-z={object.transform.z}
                data-yaw={object.transform.rotation}
              >
                <strong>{object.name}</strong>
                <small>{label}</small>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
