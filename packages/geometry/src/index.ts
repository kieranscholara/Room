import type { Conflict, Room, Scene, SceneObject, Transform } from '@roomsell/scene-core';
export * from './render-contract';

export interface Point {
  x: number;
  z: number;
}
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export const EPSILON = 1e-8;
// Matches a Three.js Y-axis rotation: local +X maps toward world -Z.
export function rotate(point: Point, angle: number): Point {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return { x: point.x * c + point.z * s, z: -point.x * s + point.z * c };
}
export function footprint(object: SceneObject): Point[] {
  const w = object.dimensions.width / 2,
    d = object.dimensions.depth / 2;
  return [
    { x: -w, z: -d },
    { x: w, z: -d },
    { x: w, z: d },
    { x: -w, z: d },
  ].map((p) => {
    const r = rotate(p, object.transform.rotation);
    return { x: r.x + object.transform.x, z: r.z + object.transform.z };
  });
}
export function bounds(points: Point[]): Bounds {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minZ: Math.min(...points.map((p) => p.z)),
    maxZ: Math.max(...points.map((p) => p.z)),
  };
}
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  // Axis-aligned broad phase avoids SAT projections for distant objects.
  const aa = bounds(a),
    bb = bounds(b);
  if (
    aa.maxX <= bb.minX + EPSILON ||
    bb.maxX <= aa.minX + EPSILON ||
    aa.maxZ <= bb.minZ + EPSILON ||
    bb.maxZ <= aa.minZ + EPSILON
  )
    return false;
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i],
        end = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      if (length <= EPSILON) continue;
      const axis = { x: -(end.z - start.z) / length, z: (end.x - start.x) / length };
      let minA = Infinity,
        maxA = -Infinity,
        minB = Infinity,
        maxB = -Infinity;
      for (const p of a) {
        const projection = p.x * axis.x + p.z * axis.z;
        minA = Math.min(minA, projection);
        maxA = Math.max(maxA, projection);
      }
      for (const p of b) {
        const projection = p.x * axis.x + p.z * axis.z;
        minB = Math.min(minB, projection);
        maxB = Math.max(maxB, projection);
      }
      if (maxA <= minB + EPSILON || maxB <= minA + EPSILON) return false;
    }
  }
  return true;
}
export interface OpeningZone {
  id: string;
  name: string;
  kind: 'door' | 'window';
  x: number;
  z: number;
  width: number;
  depth: number;
  minimumHeight: number;
}
export function openingZones(room: Room): OpeningZone[] {
  return room.openings.map((opening) => {
    const horizontal = opening.wall === 'north' || opening.wall === 'south';
    return {
      id: opening.id,
      name: opening.name,
      kind: opening.kind,
      x: horizontal ? opening.offset : opening.wall === 'west' ? 0 : room.width - opening.clearanceDepth,
      z: horizontal ? (opening.wall === 'north' ? 0 : room.depth - opening.clearanceDepth) : opening.offset,
      width: horizontal ? opening.width : opening.clearanceDepth,
      depth: horizontal ? opening.clearanceDepth : opening.width,
      minimumHeight: opening.kind === 'window' ? opening.sillHeight : 0,
    };
  });
}
const rectangle = (zone: { x: number; z: number; width: number; depth: number }): Point[] => [
  { x: zone.x, z: zone.z },
  { x: zone.x + zone.width, z: zone.z },
  { x: zone.x + zone.width, z: zone.z + zone.depth },
  { x: zone.x, z: zone.z + zone.depth },
];
export function objectConflicts(object: SceneObject, scene: Scene, placed = scene.objects): Conflict[] {
  const conflicts: Conflict[] = [],
    shape = footprint(object),
    extent = bounds(shape);
  if (object.dimensions.height > scene.room.height + EPSILON)
    conflicts.push({
      code: 'ceiling',
      message: `${object.name} is taller than the room.`,
      objectIds: [object.id],
    });
  if (
    extent.minX < -EPSILON ||
    extent.minZ < -EPSILON ||
    extent.maxX > scene.room.width + EPSILON ||
    extent.maxZ > scene.room.depth + EPSILON
  )
    conflicts.push({
      code: 'boundary',
      message: `${object.name} crosses a room wall.`,
      objectIds: [object.id],
    });
  for (const zone of scene.room.zones) {
    if (polygonsOverlap(shape, rectangle(zone)))
      conflicts.push({
        code: zone.kind === 'circulation' ? 'circulation' : 'clearance',
        message: `${object.name} blocks ${zone.name.toLowerCase()}.`,
        objectIds: [object.id, zone.id],
      });
  }
  for (const zone of openingZones(scene.room)) {
    if (object.dimensions.height > zone.minimumHeight + EPSILON && polygonsOverlap(shape, rectangle(zone)))
      conflicts.push({
        code: `${zone.kind}-clearance`,
        message: `${object.name} blocks ${zone.name.toLowerCase()} ${zone.kind === 'door' ? 'swing' : 'access'}.`,
        objectIds: [object.id, zone.id],
      });
  }
  if (object.solid)
    for (const other of placed) {
      if (other.id !== object.id && other.solid && polygonsOverlap(shape, footprint(other)))
        conflicts.push({
          code: 'collision',
          message: `${object.name} overlaps ${other.name.toLowerCase()}.`,
          objectIds: [object.id, other.id],
        });
    }
  return conflicts;
}
export function validateScene(scene: Scene): Conflict[] {
  const seen = new Set<string>();
  return scene.objects
    .flatMap((o) => objectConflicts(o, scene))
    .filter((c) => {
      const key = `${c.code}:${[...c.objectIds].sort().join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export interface MeasurementGuide {
  wall: 'north' | 'east' | 'south' | 'west';
  distance: number;
  from: Point;
  to: Point;
}
export function measurementGuides(object: SceneObject, room: Room): MeasurementGuide[] {
  const extent = bounds(footprint(object)),
    { x, z } = object.transform;
  return [
    { wall: 'west', distance: extent.minX, from: { x: extent.minX, z }, to: { x: 0, z } },
    {
      wall: 'east',
      distance: room.width - extent.maxX,
      from: { x: extent.maxX, z },
      to: { x: room.width, z },
    },
    { wall: 'north', distance: extent.minZ, from: { x, z: extent.minZ }, to: { x, z: 0 } },
    {
      wall: 'south',
      distance: room.depth - extent.maxZ,
      from: { x, z: extent.maxZ },
      to: { x, z: room.depth },
    },
  ];
}
// Snaps the rotated footprint to the closest wall on each axis. Backend validation remains mandatory.
export function snapToWalls(object: SceneObject, room: Room, threshold = 0.15): Transform {
  const extent = bounds(footprint(object)),
    transform = { ...object.transform };
  const xDeltas = [-extent.minX, room.width - extent.maxX].sort((a, b) => Math.abs(a) - Math.abs(b));
  const zDeltas = [-extent.minZ, room.depth - extent.maxZ].sort((a, b) => Math.abs(a) - Math.abs(b));
  if (Math.abs(xDeltas[0]) <= threshold) transform.x += xDeltas[0];
  if (Math.abs(zDeltas[0]) <= threshold) transform.z += zDeltas[0];
  return transform;
}
