'use client';
import { useState } from 'react';
import { Check, DoorOpen, Ruler, Trash2 } from 'lucide-react';
import { Button, Field } from '@roomsell/ui';
import type { Scene } from '@roomsell/scene-core';
import { useEditor } from '../lib/editor-store';

type Room = Scene['room'];
type Opening = Room['openings'][number];
type Zone = Room['zones'][number];

function DimensionControls({ room, disabled }: { room: Room; disabled: boolean }) {
  const { preview } = useEditor();
  const [width, setWidth] = useState(String(room.width));
  const [depth, setDepth] = useState(String(room.depth));
  const [height, setHeight] = useState(String(room.height));
  const [confirmed, setConfirmed] = useState(room.measurementsConfirmed);
  return (
    <form
      className="editor-control-form"
      onSubmit={(event) => {
        event.preventDefault();
        void preview({
          type: 'room',
          room: {
            ...room,
            width: Number(width),
            depth: Number(depth),
            height: Number(height),
            measurementsConfirmed: confirmed,
          },
        });
      }}
    >
      <div className="editor-field-grid">
        {[
          { label: 'Room width (m)', value: width, set: setWidth, max: 30 },
          { label: 'Room depth (m)', value: depth, set: setDepth, max: 30 },
          { label: 'Ceiling height (m)', value: height, set: setHeight, max: 6 },
        ].map((field) => (
          <Field key={field.label} label={field.label}>
            <input
              type="number"
              aria-label={field.label}
              min="2"
              max={field.max}
              step="0.01"
              required
              disabled={disabled}
              value={field.value}
              onChange={(event) => {
                field.set(event.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
        ))}
      </div>
      <label className="editor-check-label">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I have checked these measurements
      </label>
      <p className="editor-help">
        Walls and furniture are checked before saving. Measure the room on site before issuing a design.
      </p>
      <Button className="full-width" disabled={disabled || !confirmed} type="submit">
        <Check size={14} /> Preview room dimensions
      </Button>
    </form>
  );
}

function OpeningControls({ room, disabled }: { room: Room; disabled: boolean }) {
  const { preview } = useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Opening['kind']>('door');
  const [wall, setWall] = useState<Opening['wall']>('south');
  const [offset, setOffset] = useState('0.1');
  const [width, setWidth] = useState('0.9');
  const [height, setHeight] = useState('2.1');
  const [sillHeight, setSillHeight] = useState('0');
  const [clearanceDepth, setClearanceDepth] = useState('0.9');
  const clear = () => {
    setEditingId(null);
    setName('');
  };
  function edit(opening: Opening) {
    setEditingId(opening.id);
    setName(opening.name);
    setKind(opening.kind);
    setWall(opening.wall);
    setOffset(String(opening.offset));
    setWidth(String(opening.width));
    setHeight(String(opening.height));
    setSillHeight(String(opening.sillHeight));
    setClearanceDepth(String(opening.clearanceDepth));
  }
  return (
    <>
      <ul className="editor-feature-list">
        {room.openings.map((opening) => (
          <li key={opening.id}>
            <div>
              <strong>{opening.name}</strong>
              <small>
                {opening.wall} wall · {opening.width.toFixed(2)} m {opening.kind}
              </small>
            </div>
            <Button disabled={disabled} onClick={() => edit(opening)} aria-label={`Edit ${opening.name}`}>
              Edit
            </Button>
            <Button
              disabled={disabled}
              aria-label={`Remove ${opening.name}`}
              onClick={() =>
                void preview({
                  type: 'room',
                  room: { ...room, openings: room.openings.filter((item) => item.id !== opening.id) },
                })
              }
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="editor-control-form"
        onSubmit={(event) => {
          event.preventDefault();
          const opening: Opening = {
            id: editingId ?? `opening-${crypto.randomUUID()}`,
            name: name.trim(),
            kind,
            wall,
            offset: Number(offset),
            width: Number(width),
            height: Number(height),
            sillHeight: Number(sillHeight),
            clearanceDepth: Number(clearanceDepth),
          };
          void preview({
            type: 'room',
            room: { ...room, openings: [...room.openings.filter((item) => item.id !== editingId), opening] },
          });
        }}
      >
        <Field label="Opening name">
          <input
            aria-label="Opening name"
            value={name}
            maxLength={100}
            required
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
            placeholder="Bedroom door"
          />
        </Field>
        <div className="editor-field-grid">
          <Field label="Opening type">
            <select
              aria-label="Opening type"
              value={kind}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value as Opening['kind'];
                setKind(next);
                setSillHeight(next === 'door' ? '0' : '0.9');
                setHeight(next === 'door' ? '2.1' : '1.2');
              }}
            >
              <option value="door">Door</option>
              <option value="window">Window</option>
            </select>
          </Field>
          <Field label="Wall">
            <select
              aria-label="Opening wall"
              value={wall}
              disabled={disabled}
              onChange={(event) => setWall(event.target.value as Opening['wall'])}
            >
              {(['north', 'east', 'south', 'west'] as const).map((side) => (
                <option key={side} value={side}>
                  {side[0].toUpperCase() + side.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          {[
            { label: 'Wall offset (m)', value: offset, set: setOffset, min: 0, max: 30 },
            { label: 'Opening width (m)', value: width, set: setWidth, min: 0.1, max: 10 },
            { label: 'Opening height (m)', value: height, set: setHeight, min: 0.1, max: 6 },
            { label: 'Sill height (m)', value: sillHeight, set: setSillHeight, min: 0, max: 6 },
            {
              label: 'Opening clearance (m)',
              value: clearanceDepth,
              set: setClearanceDepth,
              min: 0.01,
              max: 10,
            },
          ].map((field) => (
            <Field key={field.label} label={field.label}>
              <input
                aria-label={field.label}
                type="number"
                value={field.value}
                min={field.min}
                max={field.max}
                step="0.01"
                required
                disabled={disabled}
                onChange={(event) => field.set(event.target.value)}
              />
            </Field>
          ))}
        </div>
        <p className="editor-help">
          Offset starts at the west end of north/south walls, or the north end of east/west walls. Clearance
          reserves floor space; a window also checks furniture height beneath its sill.
        </p>
        <Button type="submit" className="full-width" disabled={disabled}>
          <DoorOpen size={14} /> {editingId ? 'Preview opening update' : 'Preview opening'}
        </Button>
        {editingId && (
          <Button type="button" disabled={disabled} onClick={clear}>
            Cancel opening edit
          </Button>
        )}
      </form>
    </>
  );
}

function ZoneControls({ room, disabled }: { room: Room; disabled: boolean }) {
  const { preview } = useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Zone['kind']>('circulation');
  const [x, setX] = useState('0');
  const [z, setZ] = useState('0');
  const [width, setWidth] = useState('0.9');
  const [depth, setDepth] = useState('0.9');
  return (
    <>
      <ul className="editor-feature-list">
        {room.zones.map((zone) => (
          <li key={zone.id}>
            <div>
              <strong>{zone.name}</strong>
              <small>
                {zone.kind} · {zone.width.toFixed(2)} × {zone.depth.toFixed(2)} m
              </small>
            </div>
            <Button
              disabled={disabled}
              aria-label={`Edit ${zone.name}`}
              onClick={() => {
                setEditingId(zone.id);
                setName(zone.name);
                setKind(zone.kind);
                setX(String(zone.x));
                setZ(String(zone.z));
                setWidth(String(zone.width));
                setDepth(String(zone.depth));
              }}
            >
              Edit
            </Button>
            <Button
              disabled={disabled}
              aria-label={`Remove ${zone.name}`}
              onClick={() =>
                void preview({
                  type: 'room',
                  room: { ...room, zones: room.zones.filter((item) => item.id !== zone.id) },
                })
              }
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="editor-control-form"
        onSubmit={(event) => {
          event.preventDefault();
          const zone: Zone = {
            id: editingId ?? `zone-${crypto.randomUUID()}`,
            name: name.trim(),
            kind,
            x: Number(x),
            z: Number(z),
            width: Number(width),
            depth: Number(depth),
          };
          void preview({
            type: 'room',
            room: { ...room, zones: [...room.zones.filter((item) => item.id !== editingId), zone] },
          });
        }}
      >
        <Field label="Zone name">
          <input
            aria-label="Zone name"
            value={name}
            required
            maxLength={100}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
            placeholder="Clear walkway"
          />
        </Field>
        <Field label="Zone type">
          <select
            aria-label="Zone type"
            value={kind}
            disabled={disabled}
            onChange={(event) => setKind(event.target.value as Zone['kind'])}
          >
            <option value="circulation">Circulation path</option>
            <option value="obstacle">Fixed obstacle</option>
            <option value="clearance">Reserved clearance</option>
            <option value="door">Door clearance</option>
          </select>
        </Field>
        <div className="editor-field-grid">
          {[
            { label: 'Zone X (m)', value: x, set: setX, min: 0, max: room.width },
            { label: 'Zone Z (m)', value: z, set: setZ, min: 0, max: room.depth },
            { label: 'Zone width (m)', value: width, set: setWidth, min: 0.1, max: room.width },
            { label: 'Zone depth (m)', value: depth, set: setDepth, min: 0.1, max: room.depth },
          ].map((field) => (
            <Field key={field.label} label={field.label}>
              <input
                aria-label={field.label}
                type="number"
                value={field.value}
                min={field.min}
                max={field.max}
                step="0.01"
                required
                disabled={disabled}
                onChange={(event) => field.set(event.target.value)}
              />
            </Field>
          ))}
        </div>
        <p className="editor-help">
          Zones start at their north-west corner and reserve their entire footprint.
        </p>
        <Button type="submit" className="full-width" disabled={disabled}>
          {editingId ? 'Preview zone update' : 'Preview zone'}
        </Button>
        {editingId && (
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              setEditingId(null);
              setName('');
            }}
          >
            Cancel zone edit
          </Button>
        )}
      </form>
    </>
  );
}

export function RoomControls() {
  const { scene, proposal, busy } = useEditor();
  if (!scene) return null;
  const disabled = busy || Boolean(proposal);
  return (
    <div className="room-controls">
      <details className="editor-details">
        <summary>
          <Ruler size={14} /> Room measurements
        </summary>
        <DimensionControls key={scene.version} room={scene.room} disabled={disabled} />
      </details>
      <details className="editor-details">
        <summary>
          Doors &amp; windows <span>{scene.room.openings.length}</span>
        </summary>
        <OpeningControls key={scene.version} room={scene.room} disabled={disabled} />
      </details>
      <details className="editor-details">
        <summary>
          Obstacles &amp; circulation <span>{scene.room.zones.length}</span>
        </summary>
        <ZoneControls key={scene.version} room={scene.room} disabled={disabled} />
      </details>
    </div>
  );
}
