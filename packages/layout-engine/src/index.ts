import {
  lockConflicts,
  sameTransform,
  sceneSchema,
  operationSchema,
  type LayoutResult,
  type Operation,
  type Scene,
  type SceneObject,
  type Transform,
} from '@roomsell/scene-core';
import { objectConflicts, rotate, validateScene } from '@roomsell/geometry';

export const SOLVER = { version: 1, grid: 0.25, candidates: 96, maxNodes: 6000 } as const;
const alternatives = [
  'Choose another position or rotate the item.',
  'Unlock a conflicting object if you want it to move.',
  'Use a smaller product or remove an optional item.',
];
const distance = (a: Transform, b: Transform) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const angleDistance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function candidates(
  object: SceneObject,
  preferred: Transform,
  scene: Scene,
  fixed: SceneObject[],
): { object: SceneObject; cost: number }[] {
  const relationship = Boolean(object.follows);
  const raw: Transform[] = [preferred, object.transform];
  const rotations = object.locks.rotation
    ? [object.transform.rotation]
    : [...new Set([preferred.rotation, object.transform.rotation, 0, Math.PI / 2, Math.PI, -Math.PI / 2])];
  for (const rotation of rotations) {
    for (let x = SOLVER.grid; x < scene.room.width; x += SOLVER.grid) {
      for (let z = SOLVER.grid; z < scene.room.depth; z += SOLVER.grid) raw.push({ x, y: 0, z, rotation });
    }
  }
  const seen = new Set<string>();
  return raw
    .filter((t) => {
      const key = `${t.x}:${t.z}:${t.rotation}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return !object.locks.rotation || t.rotation === object.transform.rotation;
    })
    .map((transform) => {
      const result = { ...object, transform };
      const cost =
        distance(transform, object.transform) * (relationship ? 0.05 : 1) +
        distance(transform, preferred) * (relationship ? 4 : 0) +
        angleDistance(transform.rotation, preferred.rotation) * 0.2;
      return { object: result, cost };
    })
    .filter((candidate) => !objectConflicts(candidate.object, scene, fixed).length)
    .sort(
      (a, b) =>
        a.cost - b.cost ||
        a.object.transform.x - b.object.transform.x ||
        a.object.transform.z - b.object.transform.z ||
        a.object.transform.rotation - b.object.transform.rotation,
    )
    .slice(0, SOLVER.candidates);
}

export function propose(input: Scene, request: Operation): LayoutResult {
  const scene = sceneSchema.parse(input),
    operation = operationSchema.parse(request);
  if (!scene.room.measurementsConfirmed)
    return {
      ok: false,
      conflicts: [
        {
          code: 'measurements-unconfirmed',
          message: 'Confirm the room measurements before planning furniture.',
          objectIds: [],
        },
      ],
      alternatives: ['Have a person verify the room measurements.'],
    };
  const initial = validateScene(scene);
  if (initial.length)
    return { ok: false, conflicts: initial, alternatives: ['Repair the saved scene before editing.'] };
  const trial = structuredClone(scene);
  const target = trial.objects.find((o) => o.id === operation.objectId);
  if (!target)
    return {
      ok: false,
      conflicts: [
        { code: 'not-found', message: 'Furniture object does not exist.', objectIds: [operation.objectId] },
      ],
      alternatives: [],
    };
  if (operation.type === 'locks') {
    target.locks = operation.locks;
    return { ok: true, scene: trial, movedIds: [], evaluated: 1 };
  }
  const updated = { ...target, transform: operation.transform };
  const locks = lockConflicts(target, updated);
  if (locks.length)
    return { ok: false, conflicts: locks, alternatives: ['Unlock the relevant property before editing.'] };
  target.transform = operation.transform;
  if (operation.mode === 'manual') {
    const conflicts = validateScene(trial);
    return conflicts.length
      ? { ok: false, conflicts, alternatives }
      : {
          ok: true,
          scene: trial,
          movedIds: sameTransform(scene.objects.find((o) => o.id === target.id)!.transform, target.transform)
            ? []
            : [target.id],
          evaluated: 1,
        };
  }
  // Position-locked items stay wholly fixed in v1, including unlocked rotations.
  const fixed = trial.objects.filter((o) => o.id === target.id || o.locks.position);
  const fixedConflicts = fixed.flatMap((o) => objectConflicts(o, trial, fixed));
  if (fixedConflicts.length) return { ok: false, conflicts: fixedConflicts, alternatives };
  const movable = trial.objects
    .filter((o) => !fixed.includes(o))
    .sort(
      (a, b) => Number(Boolean(b.follows)) - Number(Boolean(a.follows)) || a.id.localeCompare(b.id, 'en'),
    );
  const choices = movable.map((object) => {
    let preferred = object.transform;
    if (object.follows) {
      const anchor = trial.objects.find((o) => o.id === object.follows!.anchorId)!;
      // Followers of an unchanged anchor remain in place; manual edits are allowed to break soft relationships.
      const original = scene.objects.find((o) => o.id === anchor.id)!;
      if (!sameTransform(original.transform, anchor.transform)) {
        const offset = rotate({ x: object.follows.x, z: object.follows.z }, anchor.transform.rotation);
        preferred = {
          x: anchor.transform.x + offset.x,
          y: 0,
          z: anchor.transform.z + offset.z,
          rotation: object.locks.rotation
            ? object.transform.rotation
            : Math.atan2(
                Math.sin(anchor.transform.rotation + object.follows.rotation),
                Math.cos(anchor.transform.rotation + object.follows.rotation),
              ),
        };
      }
    }
    return candidates(object, preferred, trial, fixed);
  });
  let evaluated = 0,
    bestCost = Infinity;
  let best: SceneObject[] | undefined;
  function search(index: number, placed: SceneObject[], cost: number) {
    if (evaluated >= SOLVER.maxNodes || cost >= bestCost) return;
    if (index === movable.length) {
      best = [...placed];
      bestCost = cost;
      return;
    }
    for (const candidate of choices[index]) {
      if (++evaluated > SOLVER.maxNodes) break;
      if (cost + candidate.cost >= bestCost || objectConflicts(candidate.object, trial, placed).length)
        continue;
      search(index + 1, [...placed, candidate.object], cost + candidate.cost);
    }
  }
  search(0, fixed, 0);
  if (!best)
    return {
      ok: false,
      conflicts: [
        {
          code: 'no-solution',
          message: 'No valid arrangement was found within the v1 search limit. The saved room is unchanged.',
          objectIds: [target.id],
        },
      ],
      alternatives,
    };
  const solved = best as SceneObject[];
  trial.objects = trial.objects.map((o) => solved.find((s) => s.id === o.id)!);
  const conflicts = validateScene(trial);
  for (const before of scene.objects)
    conflicts.push(
      ...lockConflicts(
        before,
        trial.objects.find((o) => o.id === before.id)!,
      ),
    );
  if (conflicts.length) return { ok: false, conflicts, alternatives };
  return {
    ok: true,
    scene: trial,
    movedIds: trial.objects
      .filter((o) => !sameTransform(o.transform, scene.objects.find((b) => b.id === o.id)!.transform))
      .map((o) => o.id),
    evaluated,
  };
}
