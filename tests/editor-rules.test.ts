import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createDemoScene,
  migrateScene,
  sceneSchema,
  type Scene,
  type SceneObject,
} from '@roomsell/scene-core';
import {
  footprint,
  bounds,
  measurementGuides,
  openingZones,
  rotate,
  snapToWalls,
  validateScene,
} from '@roomsell/geometry';
import { propose, SOLVER } from '@roomsell/layout-engine';

const cube = (id: string, x: number, z: number): SceneObject => ({
  ...createDemoScene().objects[1],
  id,
  sku: `DEMO-${id}`,
  name: id,
  dimensions: { width: 0.5, depth: 0.5, height: 0.5 },
  transform: { x, y: 0, z, rotation: 0 },
});
const simple = (): Scene => ({
  ...createDemoScene(),
  room: { ...createDemoScene().room, zones: [], openings: [] },
  objects: [cube('a', 2, 2), cube('b', 3, 2), cube('c', 5, 4)],
  groups: [],
});
const grouped = (): Scene => ({
  ...simple(),
  groups: [{ id: 'pair', name: 'Pair', objectIds: ['a', 'b'], locked: false }],
});
const move = (
  scene: Scene,
  id: string,
  x: number,
  z: number,
  rotation = 0,
  mode: 'manual' | 'smart' = 'manual',
) => propose(scene, { type: 'transform', objectId: id, transform: { x, y: 0, z, rotation }, mode });

describe('scene v2 migration and measured room operations', () => {
  it('strictly migrates v1 without changing furniture, measurements, versions or soft followers', () => {
    const canonical = createDemoScene();
    const { groups, ...rest } = canonical;
    const { openings, ...room } = canonical.room;
    expect(groups).toEqual([]);
    expect(openings).toEqual([]);
    const v1 = { ...rest, schemaVersion: 1, room };
    const migrated = migrateScene(JSON.parse(JSON.stringify(v1)));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.objects).toEqual(canonical.objects);
    expect(migrated.version).toBe(canonical.version);
    expect(migrated.room).toEqual(canonical.room);
    expect(migrated.groups).toEqual([]);
    expect(sceneSchema.safeParse({ ...v1, unknown: 'unexpected' }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...v1, schemaVersion: 3 }).success).toBe(false);
  });
  it('allows a person to confirm measurements but rejects an unconfirmed room edit', () => {
    const scene = simple();
    scene.room.measurementsConfirmed = false;
    expect(
      propose(scene, { type: 'room', room: { ...scene.room, width: 7, measurementsConfirmed: true } }).ok,
    ).toBe(true);
    expect(propose(scene, { type: 'room', room: { ...scene.room, width: 7 } }).ok).toBe(false);
  });
  it('checks all existing footprints and ceiling heights before accepting reduced room dimensions', () => {
    const scene = simple(),
      before = structuredClone(scene);
    const good = propose(scene, { type: 'room', room: { ...scene.room, width: 7 } });
    expect(good.ok).toBe(true);
    const invalid = propose(scene, { type: 'room', room: { ...scene.room, width: 4 } });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.conflicts.some((c) => c.code === 'boundary')).toBe(true);
    scene.objects[0].dimensions.height = 2.4;
    expect(propose(scene, { type: 'room', room: { ...scene.room, height: 2 } }).ok).toBe(false);
    expect(before.room.width).toBe(scene.room.width);
  });
});

describe('architectural openings and circulation', () => {
  it('reserves the conservative full door swing on every wall, including rugs', () => {
    for (const wall of ['north', 'south', 'east', 'west'] as const) {
      const scene = simple();
      scene.room.openings = [
        {
          id: 'door',
          name: 'Entry door',
          kind: 'door',
          wall,
          offset: 1,
          width: 1,
          height: 2,
          sillHeight: 0,
          clearanceDepth: 1,
        },
      ];
      const zone = openingZones(scene.room)[0];
      scene.objects = [{ ...cube('rug', zone.x + zone.width / 2, zone.z + zone.depth / 2), solid: false }];
      expect(validateScene(scene).some((c) => c.code === 'door-clearance')).toBe(true);
      expect(
        sceneSchema.safeParse({
          ...scene,
          room: { ...scene.room, openings: [{ ...scene.room.openings[0], clearanceDepth: 0.9 }] },
        }).success,
      ).toBe(false);
    }
  });
  it('allows low furniture under a sill and blocks furniture above it in the explicit window access zone', () => {
    const scene = simple();
    scene.objects = [cube('cabinet', 2, 0.4)];
    scene.room.openings = [
      {
        id: 'window',
        name: 'Window',
        kind: 'window',
        wall: 'north',
        offset: 1,
        width: 2,
        height: 1,
        sillHeight: 1,
        clearanceDepth: 0.8,
      },
    ];
    expect(validateScene(scene)).toEqual([]);
    scene.objects[0].dimensions.height = 1.1;
    expect(validateScene(scene).some((c) => c.code === 'window-clearance')).toBe(true);
  });
  it('rejects openings beyond measured walls, above the ceiling, and duplicate IDs', () => {
    const scene = simple();
    const opening = {
      id: 'door',
      name: 'Door',
      kind: 'door' as const,
      wall: 'north' as const,
      offset: 1,
      width: 1,
      height: 2,
      sillHeight: 0,
      clearanceDepth: 1,
    };
    for (const openings of [[{ ...opening, offset: 6 }], [{ ...opening, height: 3 }], [opening, opening]])
      expect(sceneSchema.safeParse({ ...scene, room: { ...scene.room, openings } }).success).toBe(false);
  });
  it('keeps explicitly measured circulation rectangles clear in manual and smart planning', () => {
    const scene = simple();
    scene.room.zones = [
      { id: 'route', name: 'Entry route', kind: 'circulation', x: 0, z: 0, width: 1, depth: 5 },
    ];
    expect(validateScene(scene)).toEqual([]);
    for (const mode of ['manual', 'smart'] as const) {
      const result = move(scene, 'a', 0.5, 2, 0, mode);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.conflicts.some((c) => c.code === 'circulation')).toBe(true);
    }
  });
});

describe('rigid groups and member locks', () => {
  it('moves every member rigidly around any selected member and preserves all product identities/dimensions', () => {
    const scene = grouped(),
      result = move(scene, 'b', 3, 3, Math.PI / 2);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected rigid movement');
    const a = result.scene.objects[0],
      b = result.scene.objects[1];
    expect(a.transform.x).toBeCloseTo(3);
    expect(a.transform.z).toBeCloseTo(4);
    expect(b.transform).toEqual({ x: 3, y: 0, z: 3, rotation: Math.PI / 2 });
    for (const original of scene.objects) {
      const after = result.scene.objects.find((o) => o.id === original.id)!;
      expect(after.sku).toBe(original.sku);
      expect(after.variantId).toBe(original.variantId);
      expect(after.dimensions).toEqual(original.dimensions);
    }
  });
  it('never bypasses group locks or another member position/rotation locks', () => {
    const scene = grouped(),
      before = structuredClone(scene);
    scene.groups[0].locked = true;
    expect(move(scene, 'a', 2, 3).ok).toBe(false);
    scene.groups[0].locked = false;
    scene.objects[1].locks.position = true;
    expect(move(scene, 'a', 2, 3).ok).toBe(false);
    scene.objects[1].locks.position = false;
    scene.objects[1].locks.rotation = true;
    expect(move(scene, 'a', 2, 2, Math.PI / 2).ok).toBe(false);
    expect(move(scene, 'a', 2, 3).ok).toBe(true);
    expect(before.objects[0]).toEqual(scene.objects[0]);
  });
  it('relocates an eligible group as one unit during Smart Rearrange and fixes it when any member position is locked', () => {
    const scene = grouped();
    const result = move(scene, 'c', 2, 2, 0, 'smart');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const a = result.scene.objects[0],
        b = result.scene.objects[1];
      expect(Math.hypot(a.transform.x - b.transform.x, a.transform.z - b.transform.z)).toBeCloseTo(1);
      expect(a.transform.rotation).toBe(b.transform.rotation);
      expect(validateScene(result.scene)).toEqual([]);
      expect(result.evaluated).toBeLessThanOrEqual(SOLVER.maxNodes);
    }
    scene.objects[1].locks.position = true;
    expect(move(scene, 'c', 2, 2, 0, 'smart').ok).toBe(false);
  });
  it('validates group creation/upsert/removal and rejects missing, duplicate or multiply grouped members', () => {
    const scene = simple(),
      group = { id: 'pair', name: 'Pair', objectIds: ['a', 'b'], locked: false };
    const created = propose(scene, { type: 'group', group });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(propose(created.scene, { type: 'group-remove', groupId: 'pair' }).ok).toBe(true);
      expect(
        propose(created.scene, { type: 'group', group: { ...group, id: 'other', objectIds: ['a', 'c'] } }).ok,
      ).toBe(false);
    }
    for (const objectIds of [
      ['a', 'missing'],
      ['a', 'a'],
    ])
      expect(propose(scene, { type: 'group', group: { ...group, objectIds } }).ok).toBe(false);
  });
  it('preserves relative transforms across generated rigid translations/rotations and leaves rejected inputs intact', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 5, noNaN: true }),
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        (x, z, rotation) => {
          const scene = grouped(),
            before = structuredClone(scene),
            result = move(scene, 'a', x, z, rotation);
          if (result.ok) {
            const a = result.scene.objects[0],
              b = result.scene.objects[1];
            const offset = rotate(
              { x: b.transform.x - a.transform.x, z: b.transform.z - a.transform.z },
              -a.transform.rotation,
            );
            expect(offset.x).toBeCloseTo(1);
            expect(offset.z).toBeCloseTo(0);
            expect(validateScene(result.scene)).toEqual([]);
          }
          expect(scene).toEqual(before);
        },
      ),
      { numRuns: 100, seed: 981 },
    );
  });
});

describe('wall snapping, measurements, catalogue placement and bounded search', () => {
  it('snaps rotated footprint edges without changing the selected angle or dimensions', () => {
    const scene = simple(),
      object = cube('snap', 0.32, 1);
    object.transform.rotation = Math.PI / 4;
    const snapped = snapToWalls(object, scene.room);
    expect(snapped.rotation).toBe(object.transform.rotation);
    expect(bounds(footprint({ ...object, transform: snapped })).minX).toBeCloseTo(0);
    expect(snapToWalls(cube('far', 2, 2), scene.room)).toEqual(cube('far', 2, 2).transform);
  });
  it('reports signed perpendicular distances to all four measured walls', () => {
    const scene = simple(),
      guides = measurementGuides(scene.objects[0], scene.room);
    expect(guides.map((guide) => guide.distance)).toEqual([1.75, 3.75, 1.75, 2.75]);
    for (const guide of guides)
      expect(Math.hypot(guide.from.x - guide.to.x, guide.from.z - guide.to.z)).toBeCloseTo(guide.distance);
  });
  it('adds only schema-valid collision-free objects and refuses product-locked or referenced removals', () => {
    const scene = simple();
    expect(propose(scene, { type: 'add-object', object: cube('new', 4, 1) }).ok).toBe(true);
    expect(propose(scene, { type: 'add-object', object: cube('a', 4, 1) }).ok).toBe(false);
    expect(propose(scene, { type: 'add-object', object: cube('new', 2, 2) }).ok).toBe(false);
    expect(propose(scene, { type: 'remove-object', objectId: 'c' }).ok).toBe(true);
    scene.objects[2].locks.product = true;
    expect(propose(scene, { type: 'remove-object', objectId: 'c' }).ok).toBe(false);
    expect(propose(grouped(), { type: 'remove-object', objectId: 'a' }).ok).toBe(false);
    expect(propose(createDemoScene(), { type: 'remove-object', objectId: 'bed' }).ok).toBe(false);
  });
  it('keeps the search bounded and deterministic for a maximum-size room with thirty objects', () => {
    const scene = simple();
    scene.room.width = 30;
    scene.room.depth = 30;
    scene.objects = Array.from({ length: 30 }, (_, i) =>
      cube(`object-${i}`, 2 + (i % 6) * 4, 2 + Math.floor(i / 6) * 4),
    );
    const request = {
      type: 'transform' as const,
      objectId: 'object-0',
      mode: 'smart' as const,
      transform: { x: 2, y: 0 as const, z: 2, rotation: 0 },
    };
    const before = structuredClone(scene),
      result = propose(scene, request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evaluated).toBeLessThanOrEqual(SOLVER.maxNodes);
      expect(validateScene(result.scene)).toEqual([]);
    }
    expect(propose(scene, request)).toEqual(result);
    expect(scene).toEqual(before);
  });
});
