'use client';
import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Group, Text, Line, Circle } from 'react-konva';
import { LockKeyhole, Minus, Plus, Hand, Maximize } from 'lucide-react';
import { Button } from '@roomsell/ui';
import { measurementGuides, openingZones, rotate, snapToWalls } from '@roomsell/geometry';
import type { Scene, SceneObject } from '@roomsell/scene-core';
import { useEditor } from '../lib/editor-store';

export default function FloorPlan({
  comparing = null,
  readOnly = false,
}: {
  comparing?: Scene | null;
  readOnly?: boolean;
}) {
  const { scene: saved, proposal, selectedId, select, preview, mode, busy } = useEditor();
  const scene = proposal?.scene ?? saved;
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(false);
  const [gridSnap, setGridSnap] = useState(true);
  const [wallSnap, setWallSnap] = useState(true);
  const [draggingObject, setDraggingObject] = useState<SceneObject | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!scene) return null;
  const height = 580;
  const scale = Math.min((width - 100) / scene.room.width, (height - 110) / scene.room.depth) * zoom;
  const ox = (width - scene.room.width * scale) / 2 + offset.x;
  const oz = (height - scene.room.depth * scale) / 2 + offset.y;
  const grid = Array.from({ length: Math.floor(scene.room.width * 2) + 1 }, (_, i) => i / 2);
  const measuredObject = draggingObject ?? scene.objects.find((object) => object.id === selectedId);
  const guides = measuredObject ? measurementGuides(measuredObject, scene.room) : [];
  const rows = Array.from({ length: Math.floor(scene.room.depth * 2) + 1 }, (_, i) => i / 2);
  return (
    <div className="plan-wrapper" ref={container}>
      <div className="plan-badge">
        <span className="live-dot" /> Measured floor plan <span>1 square = 0.5 m</span>
      </div>
      <div className="plan-snap-controls" aria-label="Snapping preferences">
        <label>
          <input type="checkbox" checked={gridSnap} onChange={(event) => setGridSnap(event.target.checked)} />{' '}
          Grid 0.1 m
        </label>
        <label>
          <input type="checkbox" checked={wallSnap} onChange={(event) => setWallSnap(event.target.checked)} />{' '}
          Wall snap
        </label>
      </div>
      <Stage
        width={width}
        height={height}
        draggable={pan}
        x={offset.x}
        y={offset.y}
        onDragEnd={(event) => {
          if (event.target === event.target.getStage())
            setOffset({ x: event.target.x(), y: event.target.y() });
        }}
        onClick={(event) => {
          if (event.target === event.target.getStage()) select('');
        }}
      >
        <Layer offsetX={offset.x} offsetY={offset.y}>
          <Group x={ox} y={oz}>
            <Rect
              width={scene.room.width * scale}
              height={scene.room.depth * scale}
              fill="#fdfbf7"
              shadowColor="#3f3729"
              shadowOpacity={0.1}
              shadowBlur={28}
            />
            {grid.map((x) => (
              <Line
                key={`x${x}`}
                points={[x * scale, 0, x * scale, scene.room.depth * scale]}
                stroke="#eae5dc"
                strokeWidth={0.8}
                listening={false}
              />
            ))}
            {rows.map((z) => (
              <Line
                key={`z${z}`}
                points={[0, z * scale, scene.room.width * scale, z * scale]}
                stroke="#eae5dc"
                strokeWidth={0.8}
                listening={false}
              />
            ))}
            {[...scene.room.zones, ...openingZones(scene.room)].map((zone) => (
              <Group key={zone.id} x={zone.x * scale} y={zone.z * scale}>
                <Rect
                  width={zone.width * scale}
                  height={zone.depth * scale}
                  fill={
                    zone.kind === 'obstacle' ? '#ddd5ce' : zone.kind === 'circulation' ? '#e0eee9' : '#f7e9cc'
                  }
                  opacity={0.8}
                  stroke="#bd9652"
                  dash={[5, 4]}
                  strokeWidth={1}
                />
                <Text
                  text={zone.name.toUpperCase().replace(' ', '\n')}
                  width={zone.width * scale}
                  height={zone.depth * scale}
                  fontSize={10}
                  fill="#947034"
                  align="center"
                  verticalAlign="middle"
                  lineHeight={1.5}
                />
              </Group>
            ))}
            {comparing && (
              <Group listening={false}>
                <Rect
                  width={comparing.room.width * scale}
                  height={comparing.room.depth * scale}
                  stroke="#9569b5"
                  strokeWidth={2}
                  dash={[8, 6]}
                />
                {comparing.objects.map((object) => (
                  <Rect
                    key={`revision-${object.id}`}
                    x={object.transform.x * scale}
                    y={object.transform.z * scale}
                    offsetX={(object.dimensions.width * scale) / 2}
                    offsetY={(object.dimensions.depth * scale) / 2}
                    width={object.dimensions.width * scale}
                    height={object.dimensions.depth * scale}
                    rotation={(-object.transform.rotation * 180) / Math.PI}
                    stroke="#9569b5"
                    strokeWidth={2}
                    dash={[6, 4]}
                    opacity={0.7}
                  />
                ))}
              </Group>
            )}
            {scene.objects.map((object) => {
              const selected = object.id === selectedId;
              const changed = proposal?.movedIds.includes(object.id);
              const rigidGroup = scene.groups.find((group) => group.objectIds.includes(object.id));
              const positionLocked =
                object.locks.position ||
                Boolean(rigidGroup?.locked) ||
                scene.objects.some(
                  (member) => rigidGroup?.objectIds.includes(member.id) && member.locks.position,
                );
              const w = object.dimensions.width * scale,
                d = object.dimensions.depth * scale;
              const extentZ =
                (Math.abs(Math.sin(object.transform.rotation)) * w +
                  Math.abs(Math.cos(object.transform.rotation)) * d) /
                2;
              const labelWidth = Math.max(w, 65);
              const anchor = scene.objects.find((o) => o.id === object.follows?.anchorId);
              const labelY =
                object.category === 'rug'
                  ? anchor && anchor.transform.z > object.transform.z
                    ? -extentZ + 6
                    : extentZ - 19
                  : object.transform.z + extentZ / scale + 0.3 < scene.room.depth
                    ? extentZ + 9
                    : -extentZ - 25;
              const labelPoint = rotate({ x: -labelWidth / 2, z: labelY }, -object.transform.rotation);
              return (
                <Group
                  key={object.id}
                  x={object.transform.x * scale}
                  y={object.transform.z * scale}
                  rotation={(-object.transform.rotation * 180) / Math.PI}
                  draggable={!readOnly && !positionLocked && !pan && !busy && !proposal}
                  onClick={() => select(object.id)}
                  onTap={() => select(object.id)}
                  onDragStart={() => {
                    select(object.id);
                    setDraggingObject(object);
                  }}
                  onDragMove={(event) => {
                    let candidate = {
                      ...object,
                      transform: {
                        ...object.transform,
                        x: event.target.x() / scale,
                        z: event.target.y() / scale,
                      },
                    };
                    if (gridSnap)
                      candidate = {
                        ...candidate,
                        transform: {
                          ...candidate.transform,
                          x: Math.round(candidate.transform.x * 10) / 10,
                          z: Math.round(candidate.transform.z * 10) / 10,
                        },
                      };
                    if (wallSnap) candidate = { ...candidate, transform: snapToWalls(candidate, scene.room) };
                    event.target.position({
                      x: candidate.transform.x * scale,
                      y: candidate.transform.z * scale,
                    });
                    setDraggingObject(candidate);
                  }}
                  onDragEnd={(event) => {
                    let transform = {
                      ...object.transform,
                      x: event.target.x() / scale,
                      z: event.target.y() / scale,
                    };
                    if (gridSnap)
                      transform = {
                        ...transform,
                        x: Math.round(transform.x * 10) / 10,
                        z: Math.round(transform.z * 10) / 10,
                      };
                    if (wallSnap) transform = snapToWalls({ ...object, transform }, scene.room);
                    setDraggingObject(null);
                    event.target.position({ x: object.transform.x * scale, y: object.transform.z * scale });
                    void preview({
                      type: 'transform',
                      objectId: object.id,
                      mode,
                      transform,
                    });
                  }}
                >
                  <Rect
                    x={-w / 2}
                    y={-d / 2}
                    width={w}
                    height={d}
                    cornerRadius={object.category === 'rug' ? 2 : 5}
                    fill={object.color}
                    stroke={selected ? '#24564b' : '#7e6b5538'}
                    strokeWidth={selected ? 2.5 : 1}
                    dash={changed ? [5, 3] : undefined}
                    shadowColor="#65513c"
                    shadowOpacity={object.solid ? 0.13 : 0}
                    shadowBlur={7}
                    shadowOffsetY={4}
                  />
                  {object.category === 'bed' && (
                    <>
                      <Rect
                        x={-w / 2 + 5}
                        y={-d / 2 + 5}
                        width={w - 10}
                        height={d - 10}
                        fill="#f3ece1"
                        cornerRadius={3}
                        listening={false}
                      />
                      <Rect
                        x={-w / 2 + 8}
                        y={-d / 2 + 8}
                        width={w / 2 - 12}
                        height={d * 0.19}
                        fill="#fffdf9"
                        cornerRadius={4}
                        listening={false}
                      />
                      <Rect
                        x={4}
                        y={-d / 2 + 8}
                        width={w / 2 - 12}
                        height={d * 0.19}
                        fill="#fffdf9"
                        cornerRadius={4}
                        listening={false}
                      />
                      <Rect
                        x={-w / 2 + 5}
                        y={-d / 2 + d * 0.34}
                        width={w - 10}
                        height={d * 0.56}
                        fill="#b7c1ad"
                        cornerRadius={2}
                        listening={false}
                      />
                      <Line
                        points={[-w / 2 + 8, d * 0.17, w / 2 - 8, d * 0.17]}
                        stroke="#94a18a"
                        strokeWidth={1}
                        listening={false}
                      />
                    </>
                  )}
                  {object.category === 'bedside' && (
                    <Circle
                      radius={w * 0.16}
                      x={0}
                      y={-d * 0.1}
                      fill="#f4eee0"
                      stroke="#aa9276"
                      strokeWidth={1}
                      listening={false}
                    />
                  )}
                  {object.category === 'wardrobe' && (
                    <Line points={[0, -d / 2 + 5, 0, d / 2 - 5]} stroke="#6b5846" listening={false} />
                  )}
                  <Text
                    text={object.category === 'rug' ? 'WOVEN RUG' : object.name}
                    x={labelPoint.x}
                    y={labelPoint.z}
                    width={labelWidth}
                    fontSize={10}
                    align="center"
                    fill="#665b4c"
                    rotation={(object.transform.rotation * 180) / Math.PI}
                    listening={false}
                  />
                  {positionLocked && (
                    <Group x={w / 2 - 8} y={-d / 2 + 8} listening={false}>
                      <Circle radius={11} fill="#24564b" />
                      <Text text="L" x={-4} y={-5} fill="white" fontSize={10} fontStyle="bold" />
                    </Group>
                  )}
                </Group>
              );
            })}
            <Rect
              width={scene.room.width * scale}
              height={scene.room.depth * scale}
              stroke="#514c42"
              strokeWidth={7}
              listening={false}
            />
            {scene.room.openings.map((opening) => {
              const horizontal = opening.wall === 'north' || opening.wall === 'south';
              const position = horizontal
                ? { x: opening.offset * scale, y: opening.wall === 'north' ? 0 : scene.room.depth * scale }
                : { x: opening.wall === 'west' ? 0 : scene.room.width * scale, y: opening.offset * scale };
              return (
                <Group key={opening.id} {...position} listening={false}>
                  <Line
                    points={horizontal ? [0, 0, opening.width * scale, 0] : [0, 0, 0, opening.width * scale]}
                    stroke={opening.kind === 'window' ? '#5e9ea9' : '#b08042'}
                    strokeWidth={8}
                  />
                  <Line
                    points={horizontal ? [0, 0, opening.width * scale, 0] : [0, 0, 0, opening.width * scale]}
                    stroke="#fdfbf7"
                    strokeWidth={3}
                  />
                </Group>
              );
            })}
            <Group listening={false}>
              {guides.map((guide) => (
                <Group key={guide.wall}>
                  <Line
                    points={[
                      guide.from.x * scale,
                      guide.from.z * scale,
                      guide.to.x * scale,
                      guide.to.z * scale,
                    ]}
                    stroke="#356b60"
                    strokeWidth={1}
                    dash={[3, 4]}
                  />
                  <Text
                    x={((guide.from.x + guide.to.x) * scale) / 2 + 4}
                    y={((guide.from.z + guide.to.z) * scale) / 2 + 4}
                    text={`${guide.distance.toFixed(2)} m`}
                    fontSize={10}
                    fill="#24564b"
                    padding={3}
                  />
                </Group>
              ))}
            </Group>
            <Text
              text={`${scene.room.width.toFixed(2)} m`}
              width={scene.room.width * scale}
              y={-30}
              fontSize={12}
              align="center"
              fill="#776f60"
              listening={false}
            />
            <Text
              text={`${scene.room.depth.toFixed(2)} m`}
              x={-38}
              y={(scene.room.depth * scale) / 2}
              fontSize={12}
              rotation={-90}
              fill="#776f60"
              listening={false}
            />
          </Group>
        </Layer>
      </Stage>
      <div className="plan-footer">
        <span>
          <LockKeyhole size={13} /> Locked objects stay exactly in place
        </span>
        <span>X / Z · metres</span>
      </div>
      <div className="zoom-controls">
        <Button
          aria-label="Zoom out"
          variant="ghost"
          disabled={zoom <= 0.6}
          onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
        >
          <Minus size={16} />
        </Button>
        <span>{Math.round(zoom * 100)}%</span>
        <Button
          aria-label="Zoom in"
          variant="ghost"
          disabled={zoom >= 2}
          onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
        >
          <Plus size={16} />
        </Button>
        <Button
          aria-label="Pan floor plan"
          title="Pan floor plan"
          aria-pressed={pan}
          variant={pan ? 'secondary' : 'ghost'}
          onClick={() => setPan((p) => !p)}
        >
          <Hand size={16} />
        </Button>
        <Button
          aria-label="Fit room"
          title="Fit room"
          variant="ghost"
          onClick={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
        >
          <Maximize size={16} />
        </Button>
      </div>
    </div>
  );
}
