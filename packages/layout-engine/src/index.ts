import {
  lockConflicts,
  sameTransform,
  sceneSchema,
  operationSchema,
  type Group,
  type LayoutResult,
  type Operation,
  type Scene,
  type SceneObject,
  type Transform,
} from '@roomsell/scene-core';
import { objectConflicts, rotate, snapToWalls, validateScene } from '@roomsell/geometry';

// Candidate generation and search are independently bounded, including for 30 × 30 m rooms.
export const SOLVER = { version: 2, grid: 0.25, candidates: 96, maxGenerated: 1536, maxNodes: 6000 } as const;
const alternatives = [
  'Choose another position or rotate the item.',
  'Unlock a conflicting object if you want it to move.',
  'Use a smaller product or remove an optional item.',
];
const distance = (a: Transform, b: Transform) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const angleDistance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const normalAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
interface Unit {
  anchor: SceneObject;
  members: SceneObject[];
  group?: Group;
}
interface Candidate {
  members: SceneObject[];
  cost: number;
}

function units(scene: Scene): Unit[] {
  const grouped = new Set(scene.groups.flatMap((group) => group.objectIds));
  return [
    ...scene.groups.map((group) => {
      const members = group.objectIds.map((id) => scene.objects.find((o) => o.id === id)!);
      return { anchor: members[0], members, group };
    }),
    ...scene.objects
      .filter((o) => !grouped.has(o.id))
      .map((object) => ({ anchor: object, members: [object] })),
  ];
}
function moveUnit(unit: Unit, transform: Transform, pivot = unit.anchor): SceneObject[] {
  const delta = transform.rotation - pivot.transform.rotation;
  if (sameTransform(transform, pivot.transform)) return unit.members;
  return unit.members.map((object) => {
    if (object.id === pivot.id) return { ...object, transform };
    const offset = rotate(
      { x: object.transform.x - pivot.transform.x, z: object.transform.z - pivot.transform.z },
      delta,
    );
    return {
      ...object,
      transform: {
        x: transform.x + offset.x,
        y: 0,
        z: transform.z + offset.z,
        rotation: delta === 0 ? object.transform.rotation : normalAngle(object.transform.rotation + delta),
      },
    };
  });
}
function unitConflicts(members: SceneObject[], scene: Scene, placed: SceneObject[]) {
  return members.flatMap((object) => objectConflicts(object, scene, [...placed, ...members]));
}
function candidates(unit: Unit, preferred: Transform, scene: Scene, fixed: SceneObject[]): Candidate[] {
  const object = unit.anchor,
    relationship = Boolean(object.follows);
  const rotationLocked = unit.members.some((member) => member.locks.rotation);
  const rotations = rotationLocked
    ? [object.transform.rotation]
    : [...new Set([preferred.rotation, object.transform.rotation, 0, Math.PI / 2, Math.PI, -Math.PI / 2])];
  const raw: Transform[] = [],
    seen = new Set<string>();
  const add = (x: number, z: number, rotation: number) => {
    if (raw.length >= SOLVER.maxGenerated || (rotationLocked && rotation !== object.transform.rotation))
      return;
    const key = `${x}:${z}:${rotation}`;
    if (!seen.has(key)) {
      seen.add(key);
      raw.push({ x, y: 0, z, rotation });
    }
  };
  add(preferred.x, preferred.z, preferred.rotation);
  add(object.transform.x, object.transform.z, object.transform.rotation);
  // Reserve global coverage before local rings so a large room cannot exhaust generation near one corner.
  for (const rotation of rotations) {
    const snapped = snapToWalls({ ...object, transform: { ...preferred, rotation } }, scene.room, 0.5);
    add(snapped.x, snapped.z, rotation);
    for (let ix = 1; ix <= 6; ix++)
      for (let iz = 1; iz <= 6; iz++) {
        add((scene.room.width * ix) / 7, (scene.room.depth * iz) / 7, rotation);
      }
  }
  // Interleave rotations at each ring; no rotation loses all candidates to the generation budget.
  const originX = Math.round(preferred.x / SOLVER.grid) * SOLVER.grid;
  const originZ = Math.round(preferred.z / SOLVER.grid) * SOLVER.grid;
  for (let ring = 0; ring <= 20 && raw.length < SOLVER.maxGenerated; ring++) {
    for (let dx = -ring; dx <= ring; dx++)
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        for (const rotation of rotations)
          add(originX + dx * SOLVER.grid, originZ + dz * SOLVER.grid, rotation);
      }
  }
  return raw
    .map((transform) => {
      const members = moveUnit(unit, transform);
      const cost =
        distance(transform, object.transform) * (relationship ? 0.05 : 1) +
        distance(transform, preferred) * (relationship ? 4 : 0) +
        angleDistance(transform.rotation, preferred.rotation) * 0.2;
      return { members, cost };
    })
    .filter(
      (candidate) =>
        !unit.members.some((before, i) => lockConflicts(before, candidate.members[i]).length) &&
        !unitConflicts(candidate.members, scene, fixed).length,
    )
    .sort(
      (a, b) =>
        a.cost - b.cost ||
        a.members[0].transform.x - b.members[0].transform.x ||
        a.members[0].transform.z - b.members[0].transform.z ||
        a.members[0].transform.rotation - b.members[0].transform.rotation,
    )
    .slice(0, SOLVER.candidates);
}
function finish(before: Scene, scene: Scene, evaluated: number): LayoutResult {
  const conflicts = validateScene(scene);
  for (const object of before.objects) {
    const after = scene.objects.find((item) => item.id === object.id);
    if (after) conflicts.push(...lockConflicts(object, after));
  }
  if (conflicts.length) return { ok: false, conflicts, alternatives };
  return {
    ok: true,
    scene,
    movedIds: scene.objects
      .filter((object) => {
        const original = before.objects.find((item) => item.id === object.id);
        return original && !sameTransform(original.transform, object.transform);
      })
      .map((object) => object.id),
    evaluated,
  };
}
const fail = (code: string, message: string, objectIds: string[] = []): LayoutResult => ({
  ok: false,
  conflicts: [{ code, message, objectIds }],
  alternatives,
});

export function propose(input: Scene, request: Operation): LayoutResult {
  const scene = sceneSchema.parse(input),
    operation = operationSchema.parse(request),
    trial = structuredClone(scene);
  // Room edits can confirm previously unconfirmed measurements. Other planning needs confirmation first.
  if (!(operation.type === 'room' ? operation.room.measurementsConfirmed : scene.room.measurementsConfirmed))
    return fail(
      'measurements-unconfirmed',
      'Have a person verify and confirm the room measurements before planning furniture.',
    );
  const initial = validateScene(scene);
  if (initial.length)
    return { ok: false, conflicts: initial, alternatives: ['Repair the saved scene before editing.'] };
  if (operation.type === 'room') {
    trial.room = operation.room;
    return finish(scene, trial, 1);
  }
  if (operation.type === 'group' || operation.type === 'group-remove') {
    if (operation.type === 'group') {
      trial.groups = trial.groups.filter((group) => group.id !== operation.group.id);
      trial.groups.push(operation.group);
    } else {
      if (!trial.groups.some((group) => group.id === operation.groupId))
        return fail('not-found', 'Furniture group does not exist.');
      trial.groups = trial.groups.filter((group) => group.id !== operation.groupId);
    }
    const parsed = sceneSchema.safeParse(trial);
    if (!parsed.success) return fail('invalid-group', parsed.error.issues[0].message);
    return finish(scene, parsed.data, 1);
  }
  if (operation.type === 'add-object') {
    trial.objects.push(operation.object);
    const parsed = sceneSchema.safeParse(trial);
    if (!parsed.success) return fail('invalid-object', parsed.error.issues[0].message, [operation.object.id]);
    return finish(scene, parsed.data, 1);
  }
  const target = trial.objects.find((o) => o.id === operation.objectId);
  if (!target) return fail('not-found', 'Furniture object does not exist.', [operation.objectId]);
  if (operation.type === 'remove-object') {
    if (target.locks.product)
      return fail('product-lock', `${target.name}'s product is locked. Unlock it before removing.`, [
        target.id,
      ]);
    if (
      trial.groups.some((group) => group.objectIds.includes(target.id)) ||
      trial.objects.some((object) => object.follows?.anchorId === target.id)
    )
      return fail(
        'object-referenced',
        'Remove this furniture from its rigid group and soft relationships before removing it.',
        [target.id],
      );
    trial.objects = trial.objects.filter((object) => object.id !== target.id);
    return finish(scene, trial, 1);
  }
  if (operation.type === 'locks') {
    target.locks = operation.locks;
    return { ok: true, scene: trial, movedIds: [], evaluated: 1 };
  }
  const targetUnit = units(trial).find((unit) => unit.members.some((member) => member.id === target.id))!;
  const updatedMembers = moveUnit(targetUnit, operation.transform, target);
  if (
    targetUnit.group?.locked &&
    updatedMembers.some((member, i) => !sameTransform(member.transform, targetUnit.members[i].transform))
  )
    return fail(
      'group-lock',
      `${targetUnit.group.name} is locked. Unlock the group before moving it.`,
      targetUnit.group.objectIds,
    );
  const locks = targetUnit.members.flatMap((before, i) => lockConflicts(before, updatedMembers[i]));
  if (locks.length)
    return { ok: false, conflicts: locks, alternatives: ['Unlock the relevant property before editing.'] };
  trial.objects = trial.objects.map(
    (object) => updatedMembers.find((member) => member.id === object.id) ?? object,
  );
  if (operation.mode === 'manual') return finish(scene, trial, 1);
  const allUnits = units(trial),
    targetIds = new Set(targetUnit.members.map((object) => object.id));
  // A rigid unit containing a position-locked member is fixed as a whole during automatic search.
  const fixedUnits = allUnits.filter(
    (unit) =>
      targetIds.has(unit.anchor.id) ||
      unit.group?.locked ||
      unit.members.some((member) => member.locks.position),
  );
  const fixed = fixedUnits.flatMap((unit) => unit.members);
  const fixedConflicts = fixed.flatMap((object) => objectConflicts(object, trial, fixed));
  if (fixedConflicts.length) return { ok: false, conflicts: fixedConflicts, alternatives };
  const movable = allUnits
    .filter((unit) => !fixedUnits.includes(unit))
    .sort(
      (a, b) =>
        Number(Boolean(b.anchor.follows)) - Number(Boolean(a.anchor.follows)) ||
        a.anchor.id.localeCompare(b.anchor.id, 'en'),
    );
  const choices = movable.map((unit) => {
    const object = unit.anchor;
    let preferred = object.transform;
    if (object.follows) {
      const anchor = trial.objects.find((o) => o.id === object.follows!.anchorId)!;
      const original = scene.objects.find((o) => o.id === anchor.id)!;
      if (!sameTransform(original.transform, anchor.transform)) {
        const offset = rotate({ x: object.follows.x, z: object.follows.z }, anchor.transform.rotation);
        preferred = {
          x: anchor.transform.x + offset.x,
          y: 0,
          z: anchor.transform.z + offset.z,
          rotation: object.locks.rotation
            ? object.transform.rotation
            : normalAngle(anchor.transform.rotation + object.follows.rotation),
        };
      }
    }
    return candidates(unit, preferred, trial, fixed);
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
      if (evaluated >= SOLVER.maxNodes) break;
      evaluated++;
      if (cost + candidate.cost >= bestCost || unitConflicts(candidate.members, trial, placed).length)
        continue;
      search(index + 1, [...placed, ...candidate.members], cost + candidate.cost);
    }
  }
  search(0, fixed, 0);
  if (!best)
    return fail(
      'no-solution',
      'No valid arrangement was found within the bounded search. Try another placement; the saved room is unchanged.',
      [target.id],
    );
  const solved = best as SceneObject[];
  trial.objects = trial.objects.map((object) => solved.find((result) => result.id === object.id)!);
  return finish(scene, trial, evaluated);
}
