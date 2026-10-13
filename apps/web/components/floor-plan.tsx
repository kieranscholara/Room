'use client';
import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Group, Text, Line, Circle } from 'react-konva';
import { LockKeyhole, Minus, Plus, Hand, Maximize } from 'lucide-react';
import { Button } from '@roomsell/ui';
import { rotate } from '@roomsell/geometry';
import { useEditor } from '../lib/editor-store';

export default function FloorPlan() {
  const { scene: saved, proposal, selectedId, select, preview, mode, busy } = useEditor();
  const scene = proposal?.scene ?? saved;
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(false);
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
  const rows = Array.from({ length: Math.floor(scene.room.depth * 2) + 1 }, (_, i) => i / 2);
  return (
    <div className="plan-wrapper" ref={container}>
      <div className="plan-badge">
        <span className="live-dot" /> Measured floor plan <span>1 square = 0.5 m</span>
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
            {scene.room.zones.map((zone) => (
              <Group key={zone.id} x={zone.x * scale} y={zone.z * scale}>
                <Rect
                  width={zone.width * scale}
                  height={zone.depth * scale}
                  fill="#f7e9cc"
                  opacity={0.8}
                  stroke="#bd9652"
                  dash={[5, 4]}
                  strokeWidth={1}
                />
                <Text
                  text="DOOR\nCLEARANCE"
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
            {scene.objects.map((object) => {
              const selected = object.id === selectedId;
              const changed = proposal?.movedIds.includes(object.id);
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
                  draggable={!object.locks.position && !pan && !busy && !proposal}
                  onClick={() => select(object.id)}
                  onTap={() => select(object.id)}
                  onDragStart={() => select(object.id)}
                  onDragEnd={(event) => {
                    const x = Math.round((event.target.x() / scale) * 10) / 10;
                    const z = Math.round((event.target.y() / scale) * 10) / 10;
                    event.target.position({ x: object.transform.x * scale, y: object.transform.z * scale });
                    void preview({
                      type: 'transform',
                      objectId: object.id,
                      mode,
                      transform: { ...object.transform, x, z },
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
                  {object.locks.position && (
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
