import type { Conflict, Scene, SceneObject } from '@roomsell/scene-core';

export interface Point {
  x: number;
  z: number;
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
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i],
        end = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const axis = { x: -(end.z - start.z) / length, z: (end.x - start.x) / length };
      const pa = a.map((p) => p.x * axis.x + p.z * axis.z);
      const pb = b.map((p) => p.x * axis.x + p.z * axis.z);
      if (Math.max(...pa) <= Math.min(...pb) + EPSILON || Math.max(...pb) <= Math.min(...pa) + EPSILON)
        return false;
    }
  }
  return true;
}
export function objectConflicts(object: SceneObject, scene: Scene, placed = scene.objects): Conflict[] {
  const conflicts: Conflict[] = [];
  const shape = footprint(object);
  if (object.dimensions.height > scene.room.height + EPSILON)
    conflicts.push({
      code: 'ceiling',
      message: `${object.name} is taller than the room.`,
      objectIds: [object.id],
    });
  if (
    shape.some(
      (p) =>
        p.x < -EPSILON ||
        p.z < -EPSILON ||
        p.x > scene.room.width + EPSILON ||
        p.z > scene.room.depth + EPSILON,
    )
  )
    conflicts.push({
      code: 'boundary',
      message: `${object.name} crosses a room wall.`,
      objectIds: [object.id],
    });
  for (const zone of scene.room.zones) {
    const polygon = [
      { x: zone.x, z: zone.z },
      { x: zone.x + zone.width, z: zone.z },
      { x: zone.x + zone.width, z: zone.z + zone.depth },
      { x: zone.x, z: zone.z + zone.depth },
    ];
    if (polygonsOverlap(shape, polygon))
      conflicts.push({
        code: 'clearance',
        message: `${object.name} blocks ${zone.name.toLowerCase()}.`,
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
