'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BedDouble,
  Check,
  ChevronRight,
  CopyCheck,
  Grid2X2,
  Layers,
  LockKeyhole,
  MousePointer2,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Undo2,
  Redo2,
  Unlock,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button, Field } from '@roomsell/ui';
import type { Scene, SceneObject } from '@roomsell/scene-core';
import { measurementGuides, snapToWalls } from '@roomsell/geometry';
import { RoomControls } from './room-controls';
import { GroupControls } from './group-controls';
import { RevisionControls } from './revision-controls';
import { useEditor } from '../lib/editor-store';

const FloorPlan = dynamic(() => import('./floor-plan'), {
  ssr: false,
  loading: () => <div className="canvas-loading">Preparing measured floor plan…</div>,
});
function Properties({ object, demo, readOnly }: { object: SceneObject; demo: boolean; readOnly: boolean }) {
  const { scene, proposal, busy, mode, preview } = useEditor();
  const [x, setX] = useState(String(object.transform.x));
  const [z, setZ] = useState(String(object.transform.z));
  const [angle, setAngle] = useState(String(Math.round((object.transform.rotation * 180) / Math.PI)));
  useEffect(() => {
    setX(String(object.transform.x));
    setZ(String(object.transform.z));
    setAngle(String(Math.round((object.transform.rotation * 180) / Math.PI)));
  }, [object, scene?.version]);
  const disabled = readOnly || busy || Boolean(proposal);
  const group = scene?.groups.find((candidate) => candidate.objectIds.includes(object.id));
  const members = scene?.objects.filter((candidate) => group?.objectIds.includes(candidate.id)) ?? [];
  const positionLocked =
    object.locks.position || Boolean(group?.locked) || members.some((member) => member.locks.position);
  const rotationLocked =
    object.locks.rotation ||
    Boolean(group?.locked) ||
    members.some((member) => member.locks.rotation || (member.id !== object.id && member.locks.position));
  return (
    <>
      <div className="product-preview">
        <div className={`product-proxy proxy-${object.category}`} style={{ backgroundColor: object.color }}>
          <BedDouble size={38} strokeWidth={1.1} />
        </div>
        <span>{demo ? 'Illustrative demo furniture' : 'Catalogue dimension proxy'}</span>
      </div>
      <div className="product-title">
        <h3>{object.name}</h3>
        <span className="tag">{demo ? 'DEMO' : 'CATALOGUE'}</span>
      </div>
      <p className="sku">
        {object.sku} · {object.variantId}
      </p>
      <div className="dimensions">
        <span>
          <strong>{object.dimensions.width.toFixed(2)}</strong> W
        </span>
        <span>
          <strong>{object.dimensions.depth.toFixed(2)}</strong> D
        </span>
        <span>
          <strong>{object.dimensions.height.toFixed(2)}</strong> H
        </span>
        <span>metres</span>
      </div>
      <div className="section-label">PLACEMENT</div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void preview({
            type: 'transform',
            objectId: object.id,
            mode,
            transform: { x: Number(x), y: 0, z: Number(z), rotation: (Number(angle) * Math.PI) / 180 },
          });
        }}
      >
        <div className="coordinate-fields">
          <Field label="X position (m)">
            <input
              aria-label="X position (m)"
              type="number"
              min="0"
              max={scene?.room.width}
              step="0.1"
              required
              value={x}
              disabled={disabled || positionLocked}
              onChange={(e) => setX(e.target.value)}
            />
          </Field>
          <Field label="Z position (m)">
            <input
              aria-label="Z position (m)"
              type="number"
              min="0"
              max={scene?.room.depth}
              step="0.1"
              required
              value={z}
              disabled={disabled || positionLocked}
              onChange={(e) => setZ(e.target.value)}
            />
          </Field>
        </div>
        <div className="rotation-field">
          <Field label="Rotation (°)">
            <input
              aria-label="Rotation (degrees)"
              type="number"
              min="-360"
              max="360"
              step="1"
              required
              value={angle}
              disabled={disabled || rotationLocked}
              onChange={(e) => setAngle(e.target.value)}
            />
          </Field>
          <Button
            type="button"
            aria-label="Rotate 90 degrees"
            title="Rotate 90 degrees"
            disabled={disabled || rotationLocked}
            onClick={() => {
              const rotation = Math.atan2(
                Math.sin(object.transform.rotation + Math.PI / 2),
                Math.cos(object.transform.rotation + Math.PI / 2),
              );
              void preview({
                type: 'transform',
                objectId: object.id,
                mode,
                transform: { ...object.transform, rotation },
              });
            }}
          >
            <RotateCw size={16} />
          </Button>
        </div>
        <Button
          type="submit"
          className="full-width"
          disabled={disabled || (positionLocked && rotationLocked)}
        >
          <MousePointer2 size={15} /> Preview placement
        </Button>
      </form>
      {group && (
        <p className="group-note">
          <Layers size={14} /> {group.name} · {group.locked ? 'group locked' : 'rigid movement'}. Moving this
          piece moves all {group.objectIds.length} members.
        </p>
      )}
      {scene && (
        <div className="editor-distance-guides" aria-label="Wall distance guides">
          <div className="section-label">WALL DISTANCES</div>
          <dl>
            {measurementGuides(object, scene.room).map((guide) => (
              <div key={guide.wall}>
                <dt>{guide.wall}</dt>
                <dd>{guide.distance.toFixed(2)} m</dd>
              </div>
            ))}
          </dl>
          <Button
            className="full-width"
            disabled={disabled || positionLocked}
            onClick={() =>
              void preview({
                type: 'transform',
                objectId: object.id,
                mode,
                transform: snapToWalls(object, scene.room, 0.25),
              })
            }
          >
            Snap to nearby walls
          </Button>
          <p className="editor-help">
            Snaps an edge within 0.25 m of a wall. Furniture, architectural clearance, and locks are checked.
          </p>
        </div>
      )}
      <div className="section-label">OBJECT LOCKS</div>
      <div className="lock-list">
        {(['position', 'rotation', 'product'] as const).map((key) => (
          <button
            key={key}
            className={`lock-row ${object.locks[key] ? 'is-locked' : ''}`}
            aria-label={`${object.locks[key] ? 'Unlock' : 'Lock'} ${key}`}
            aria-pressed={object.locks[key]}
            disabled={disabled}
            onClick={() =>
              void preview(
                { type: 'locks', objectId: object.id, locks: { ...object.locks, [key]: !object.locks[key] } },
                true,
              )
            }
          >
            {object.locks[key] ? <LockKeyhole size={16} /> : <Unlock size={16} />}
            <span>
              {key === 'product' ? 'Product / SKU' : `${key[0].toUpperCase()}${key.slice(1)}`}
              <small>
                {key === 'position'
                  ? 'Keep its exact location'
                  : key === 'rotation'
                    ? 'Keep its orientation'
                    : 'Keep this exact product'}
              </small>
            </span>
            <span className="toggle">
              <i />
            </span>
          </button>
        ))}
      </div>
      {object.follows && (
        <p className="group-note">
          <Layers size={14} /> Follows the bed in Smart mode. This relationship is a preference; locks take
          priority.
        </p>
      )}
    </>
  );
}

interface EditorProps {
  projectId?: string;
  endpoint?: string;
  title?: string;
  subtitle?: string;
  readOnly?: boolean;
}
export function Editor({
  projectId,
  endpoint = projectId ? `/api/projects/${encodeURIComponent(projectId)}/scene` : '/api/scene',
  title,
  subtitle,
  readOnly = false,
}: EditorProps = {}) {
  const {
    scene,
    selectedId,
    select,
    load,
    mode,
    setMode,
    busy,
    error,
    proposal,
    accept,
    cancel,
    canUndo,
    canRedo,
    history,
  } = useEditor();
  const [savedMessage, setSavedMessage] = useState('');
  const [comparing, setComparing] = useState<Scene | null>(null);
  useEffect(() => {
    setComparing(null);
    setSavedMessage('');
    void load(endpoint);
  }, [load, endpoint]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (event.key === 'Escape' && !busy) cancel();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (!proposal && !busy && !readOnly) {
          if (event.shiftKey && canRedo) void history('redo');
          else if (!event.shiftKey && canUndo) void history('undo');
        }
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [history, cancel, busy, proposal, canRedo, canUndo, readOnly]);
  const shown = proposal?.scene ?? scene;
  const selected = shown?.objects.find((o) => o.id === selectedId);
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href={projectId ? '/workspace' : '/'} aria-label="RoomSell home">
          <span className="brand-icon">
            <Layers size={22} />
          </span>
          roomsell<span className="brand-ai">AI</span>
        </a>
        <div className="workspace-name">
          Room studio <ChevronRight size={14} /> {projectId ? 'Project design' : 'Bedroom study'}
        </div>
        <span className="demo-pill">{projectId ? 'Organisation workspace' : 'Local development demo'}</span>
        <div className="avatar" title={projectId ? 'Project workspace' : 'Local demo workspace'}>
          RS
        </div>
      </header>
      <main>
        <div className="project-heading">
          <div>
            <p className="eyebrow">
              <ArrowLeft size={13} /> {projectId ? 'PROJECT / ROOM DESIGN' : 'BEDROOM / FIRST DESIGN'}
            </p>
            <h1>
              {title ?? scene?.room.name ?? 'The calm bedroom'}
              <span className="status-badge">In progress</span>
            </h1>
            <p>{subtitle ?? 'A little more space. A room that feels like home.'}</p>
          </div>
          <div className="heading-actions">
            <div className="save-status">
              <Check size={14} />{' '}
              {savedMessage || (scene ? `Saved · revision ${scene.version}` : 'Connecting…')}
            </div>
            <Button
              disabled={!scene || busy || Boolean(proposal)}
              onClick={() => {
                if (!scene) return;
                const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob),
                  anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `roomsell-scene-v${scene.version}.json`;
                anchor.click();
                URL.revokeObjectURL(url);
                setSavedMessage('Scene JSON exported');
              }}
            >
              <CopyCheck size={16} /> Export scene
            </Button>
          </div>
        </div>
        <div className="studio-grid">
          <aside className="left-panel panel">
            <div className="panel-heading">
              <h2>Room essentials</h2>
              <Grid2X2 size={17} />
            </div>
            <div className="room-details">
              <span className="room-icon">
                <BedDouble size={23} />
              </span>
              <div>
                <strong>Rectangular bedroom</strong>
                <small>
                  {scene
                    ? `${scene.room.width} × ${scene.room.depth} m · ${scene.room.width * scene.room.depth} m²`
                    : 'Loading dimensions'}
                </small>
              </div>
            </div>
            <div className="confirmed">
              <ShieldCheck size={13} />{' '}
              {scene?.room.measurementsConfirmed
                ? 'Measurements confirmed'
                : 'Measurements need confirmation'}
              {!projectId && ' · demo'}
            </div>
            <RoomControls readOnly={readOnly} />
            <GroupControls readOnly={readOnly} />
            <div className="section-label">
              FURNITURE <span>{shown?.objects.length ?? 0} items</span>
            </div>
            <div className="furniture-list">
              {shown?.objects.map((object) => (
                <button
                  key={object.id}
                  data-testid={`select-${object.id}`}
                  className={`furniture-row ${selectedId === object.id ? 'selected' : ''}`}
                  onClick={() => select(object.id)}
                >
                  <span
                    className={`furniture-swatch swatch-${object.category}`}
                    style={{ backgroundColor: object.color }}
                  />
                  <span>
                    <strong>{object.name}</strong>
                    <small>
                      {object.dimensions.width.toFixed(2)} × {object.dimensions.depth.toFixed(2)} m
                    </small>
                  </span>
                  {object.locks.position ? (
                    <LockKeyhole size={14} className="locked-icon" />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
              ))}
            </div>
            {!projectId && (
              <div className="relationships">
                <Layers size={17} />
                <div>
                  <strong>Bedroom group</strong>
                  <p>Bedside tables and rug follow the bed during Smart Rearrange.</p>
                </div>
              </div>
            )}
            <div className="design-note">
              <span>DESIGN NOTE</span>
              <p>Start with the pieces you love. Lock them, then explore the rest.</p>
              <div className="note-line" />
            </div>
            {!projectId && (
              <p className="demo-disclaimer">
                Synthetic furniture for testing. No retailer inventory, pricing, or quotations are connected.
              </p>
            )}
          </aside>
          <section className="canvas-panel panel" aria-label="Room editor">
            <div className="canvas-toolbar">
              <div className="view-tab">
                <Grid2X2 size={15} /> 2D floor plan
              </div>
              <span className="toolbar-divider" />
              <span className="toolbar-hint">Drag to explore · preview before saving</span>
              <div className="history-controls">
                <Button
                  variant="ghost"
                  aria-label="Undo"
                  title="Undo (Ctrl+Z)"
                  disabled={readOnly || !canUndo || busy || Boolean(proposal)}
                  onClick={() => void history('undo')}
                >
                  <Undo2 size={17} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label="Redo"
                  title="Redo (Ctrl+Shift+Z)"
                  disabled={readOnly || !canRedo || busy || Boolean(proposal)}
                  onClick={() => void history('redo')}
                >
                  <Redo2 size={17} />
                </Button>
              </div>
            </div>
            {!scene ? (
              <div className="canvas-loading" role="status">
                {error || 'Loading your measured room…'}
                {error && <Button onClick={() => void load()}>Retry</Button>}
              </div>
            ) : (
              <FloorPlan comparing={comparing} readOnly={readOnly} />
            )}
            <div className="mode-bar">
              <div>
                <span className="section-label">EDITING MODE</span>
                <div className="mode-buttons">
                  <button
                    aria-pressed={mode === 'manual'}
                    className={mode === 'manual' ? 'active' : ''}
                    disabled={readOnly || busy || Boolean(proposal)}
                    onClick={() => setMode('manual')}
                  >
                    <MousePointer2 size={14} /> Manual
                  </button>
                  <button
                    aria-pressed={mode === 'smart'}
                    className={mode === 'smart' ? 'active' : ''}
                    disabled={readOnly || busy || Boolean(proposal)}
                    onClick={() => setMode('smart')}
                  >
                    <Sparkles size={14} /> Smart Rearrange
                  </button>
                </div>
              </div>
              <p>
                {readOnly
                  ? 'View-only project. You can inspect the plan and its saved revisions.'
                  : mode === 'smart'
                    ? 'Move a piece. We’ll find room for the others.'
                    : 'Move the selected piece or its rigid group. Invalid moves are rejected.'}
                <small>Geometry first. Every lock respected.</small>
              </p>
            </div>
            {scene && (
              <RevisionControls
                scene={scene}
                endpoint={endpoint}
                onCompare={setComparing}
                comparing={comparing}
              />
            )}
            {proposal && (
              <div className="proposal-bar" role="region" aria-label="Layout preview">
                <div>
                  <strong>
                    <Sparkles size={16} /> Review your change
                  </strong>
                  <p>
                    {proposal.movedIds.length
                      ? `${proposal.movedIds.length} furniture pieces repositioned. Locked properties preserved.`
                      : 'Update checked. Ready to save.'}{' '}
                    Saved revision stays unchanged until accepted.
                  </p>
                </div>
                <Button disabled={busy} onClick={cancel}>
                  <X size={15} /> Discard
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => void accept()}>
                  <Check size={15} /> Accept layout
                </Button>
              </div>
            )}
            {error && (
              <div className="error-message" role="alert">
                <div>
                  <strong>Change could not be applied</strong>
                  <p>{error}</p>
                  <small>
                    Try another location, rotate the item, or unlock a conflicting object. Your saved scene is
                    unchanged.
                  </small>
                </div>
                <Button onClick={() => void load()} disabled={busy}>
                  <RefreshCw size={14} /> Reload saved
                </Button>
              </div>
            )}
          </section>
          <aside className="right-panel panel" aria-label="Furniture properties">
            <div className="panel-heading">
              <h2>Selected furniture</h2>
              <MousePointer2 size={16} />
            </div>
            {selected ? (
              <Properties object={selected} demo={!projectId} readOnly={readOnly} />
            ) : (
              <p className="empty-selection">
                Select furniture in the plan or list to inspect its position and locks.
              </p>
            )}
          </aside>
        </div>
        <footer className="page-footer">
          <span>
            <ShieldCheck size={14} /> Constraint-aware planning · deterministic engine v2
          </span>
          <span>
            {busy
              ? 'Checking your change…'
              : projectId
                ? 'Project scene persistence active'
                : 'Local scene persistence active'}
            <ArrowUpRight size={13} />
          </span>
        </footer>
      </main>
    </div>
  );
}
