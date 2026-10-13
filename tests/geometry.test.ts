import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDemoScene, sceneSchema, lockConflicts, type SceneObject } from '@roomsell/scene-core';
import { footprint, polygonsOverlap, rotate, validateScene } from '@roomsell/geometry';
import { propose } from '@roomsell/layout-engine';

const box = (x: number, z: number, width: number, depth: number, rotation = 0): SceneObject => ({
  ...createDemoScene().objects[1],
  id: `box-${x}-${z}`,
  dimensions: { width, depth, height: 1 },
  transform: { x, y: 0, z, rotation },
});
describe('versioned scene contract', () => {
  it('validates the measured fixture and exact JSON round trip', () => {
    const scene = createDemoScene();
    expect(validateScene(scene)).toEqual([]);
    expect(sceneSchema.parse(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
  });
  it('rejects duplicate IDs, missing dimensions, nonfinite positions and unknown schema versions', () => {
    const scene = createDemoScene();
    expect(sceneSchema.safeParse({ ...scene, schemaVersion: 3 }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...scene, objects: [scene.objects[1], scene.objects[1]] }).success).toBe(
      false,
    );
    const bad = structuredClone(scene);
    bad.objects[0].dimensions.width = -1;
    expect(sceneSchema.safeParse(bad).success).toBe(false);
    bad.objects[0].transform.x = Infinity;
    expect(sceneSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects invalid relationships and architectural zones', () => {
    const scene = createDemoScene();
    scene.objects[0].follows!.anchorId = 'missing';
    expect(sceneSchema.safeParse(scene).success).toBe(false);
    scene.objects[0].follows!.anchorId = 'bed';
    scene.room.zones[0].x = -1;
    expect(sceneSchema.safeParse(scene).success).toBe(false);
  });
});
describe('oriented geometry', () => {
  it('uses the specified right-handed X/Y/Z coordinate convention', () => {
    const point = rotate({ x: 1, z: 0 }, Math.PI / 2);
    expect(point.x).toBeCloseTo(0);
    expect(point.z).toBeCloseTo(-1);
  });
  it('detects a collision introduced by rotation', () => {
    const a = box(2, 2, 2, 0.5),
      b = box(2, 3, 0.5, 0.5);
    expect(polygonsOverlap(footprint(a), footprint(b))).toBe(false);
    a.transform.rotation = Math.PI / 2;
    expect(polygonsOverlap(footprint(a), footprint(b))).toBe(true);
  });
  it('allows edge contact but rejects genuine solid overlap', () => {
    expect(polygonsOverlap(footprint(box(1, 1, 1, 1)), footprint(box(2, 1, 1, 1)))).toBe(false);
    expect(polygonsOverlap(footprint(box(1, 1, 1, 1)), footprint(box(1.9, 1, 1, 1)))).toBe(true);
  });
  it('checks rotated boundaries and door clearance, including rugs', () => {
    const scene = createDemoScene();
    scene.objects[1].transform = { x: 0.4, y: 0, z: 2, rotation: Math.PI / 4 };
    expect(validateScene(scene).some((c) => c.code === 'boundary')).toBe(true);
    scene.objects[0].transform = { x: 1, y: 0, z: 4, rotation: 0 };
    expect(validateScene(scene).some((c) => c.code === 'clearance')).toBe(true);
  });
  it('treats rugs as nonsolid overlays but still checks architectural bounds', () => {
    const scene = createDemoScene();
    expect(validateScene(scene)).toEqual([]);
    scene.objects[0].solid = true;
    expect(validateScene(scene).some((c) => c.code === 'collision')).toBe(true);
  });
  it('rejects furniture taller than the measured ceiling', () => {
    const scene = createDemoScene();
    scene.objects[1].dimensions.height = 3;
    expect(validateScene(scene).some((c) => c.code === 'ceiling')).toBe(true);
  });
  it('has symmetric collision results for generated oriented rectangles', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.double({ min: 0.1, max: 10, noNaN: true }),
          fc.double({ min: 0.1, max: 10, noNaN: true }),
          fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        ),
        fc.tuple(
          fc.double({ min: 0.1, max: 10, noNaN: true }),
          fc.double({ min: 0.1, max: 10, noNaN: true }),
          fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        ),
        (a, b) => {
          const pa = footprint(box(a[0], a[1], 1.7, 0.8, a[2])),
            pb = footprint(box(b[0], b[1], 1.2, 0.6, b[2]));
          expect(polygonsOverlap(pa, pb)).toBe(polygonsOverlap(pb, pa));
        },
      ),
      { numRuns: 250, seed: 711 },
    );
  });
});
describe('deterministic smart rearrangement and locks', () => {
  it('requires human-confirmed measurements before layout operations', () => {
    const scene = createDemoScene();
    scene.room.measurementsConfirmed = false;
    const result = propose(scene, {
      type: 'transform',
      objectId: 'bed',
      mode: 'smart',
      transform: scene.objects[1].transform,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts[0].code).toBe('measurements-unconfirmed');
  });
  it('returns a bounded-search failure when no free space remains, preserving the entire previous scene', () => {
    const scene = createDemoScene();
    scene.room.width = 2;
    scene.room.depth = 2;
    scene.room.zones = [
      { id: 'walkway', name: 'Required walkway', kind: 'clearance', x: 0, z: 1, width: 2, depth: 1 },
    ];
    scene.objects = [box(0.5, 0.5, 1, 1), box(1.5, 0.5, 1, 1)];
    expect(validateScene(scene)).toEqual([]);
    const before = structuredClone(scene);
    const result = propose(scene, {
      type: 'transform',
      objectId: scene.objects[0].id,
      mode: 'smart',
      transform: { x: 1, y: 0, z: 0.5, rotation: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflicts[0].code).toBe('no-solution');
    expect(scene).toEqual(before);
  });
  it('moves the bed, eligible bedside tables and rug while preserving the locked wardrobe exactly', () => {
    const scene = createDemoScene(),
      before = structuredClone(scene);
    const operation = {
      type: 'transform',
      objectId: 'bed',
      mode: 'smart',
      transform: { x: 3, y: 0, z: 3.8, rotation: Math.PI },
    } as const;
    const result = propose(scene, operation);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a layout');
    expect(result.movedIds).toEqual(expect.arrayContaining(['bed', 'bedside-left', 'bedside-right', 'rug']));
    expect(result.scene.objects.find((o) => o.id === 'wardrobe')).toEqual(
      before.objects.find((o) => o.id === 'wardrobe'),
    );
    expect(result.scene.objects.find((o) => o.id === 'bedside-left')!.transform.x).toBeCloseTo(4.2);
    expect(result.scene.objects.find((o) => o.id === 'bedside-left')!.transform.z).toBeCloseTo(4.5);
    expect(validateScene(result.scene)).toEqual([]);
    expect(scene).toEqual(before);
    expect(propose(scene, operation)).toEqual(result);
  });
  it('rejects direct position- and rotation-locked movements', () => {
    const scene = createDemoScene();
    const wardrobe = scene.objects.find((o) => o.id === 'wardrobe')!;
    for (const transform of [
      { ...wardrobe.transform, x: 4 },
      { ...wardrobe.transform, rotation: 0.4 },
    ]) {
      const result = propose(scene, { type: 'transform', objectId: wardrobe.id, mode: 'smart', transform });
      expect(result.ok).toBe(false);
    }
  });
  it('respects rotation-only locks while allowing position changes', () => {
    const scene = createDemoScene();
    scene.objects.find((o) => o.id === 'bedside-left')!.locks.rotation = true;
    const result = propose(scene, {
      type: 'transform',
      objectId: 'bed',
      mode: 'smart',
      transform: { x: 3, y: 0, z: 3.8, rotation: Math.PI },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.scene.objects.find((o) => o.id === 'bedside-left')!.transform.rotation).toBe(0);
  });
  it('preserves locked followers and every SKU, variant and physical dimension', () => {
    const scene = createDemoScene();
    scene.objects.find((o) => o.id === 'bedside-left')!.locks.position = true;
    const result = propose(scene, {
      type: 'transform',
      objectId: 'bed',
      mode: 'smart',
      transform: { x: 3, y: 0, z: 3.8, rotation: Math.PI },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      for (const before of scene.objects) {
        const after = result.scene.objects.find((o) => o.id === before.id)!;
        expect(lockConflicts(before, after)).toEqual([]);
        expect(after.sku).toBe(before.sku);
        expect(after.variantId).toBe(before.variantId);
        expect(after.dimensions).toEqual(before.dimensions);
      }
  });
  it('detects product-lock violations independently', () => {
    const wardrobe = createDemoScene().objects.find((o) => o.id === 'wardrobe')!;
    expect(lockConflicts(wardrobe, { ...wardrobe, sku: 'OTHER' })[0].code).toBe('product-lock');
  });
  it('manual mode does not move followers', () => {
    const scene = createDemoScene();
    const result = propose(scene, {
      type: 'transform',
      objectId: 'bed',
      mode: 'manual',
      transform: { x: 3, y: 0, z: 3.8, rotation: Math.PI },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.movedIds).toEqual(['bed']);
  });
  it('rejects collisions, walls, clearances and impossible space without mutating input', () => {
    const scene = createDemoScene(),
      before = structuredClone(scene);
    for (const [x, z] of [
      [5.55, 3.4],
      [0, 2],
      [0.8, 4.1],
    ]) {
      expect(
        propose(scene, {
          type: 'transform',
          objectId: 'bed',
          mode: 'smart',
          transform: { x, y: 0, z, rotation: 0 },
        }).ok,
      ).toBe(false);
    }
    const crowded = createDemoScene();
    crowded.objects.find((o) => o.id === 'bedside-left')!.locks.position = true;
    expect(
      propose(crowded, {
        type: 'transform',
        objectId: 'bed',
        mode: 'smart',
        transform: { x: 1.8, y: 0, z: 0.7, rotation: 0 },
      }).ok,
    ).toBe(false);
    expect(scene).toEqual(before);
  });
  it('preserves lock invariants and valid geometry across generated smart operations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 50 }),
        fc.constantFrom(0, Math.PI / 2, Math.PI, -Math.PI / 2),
        (x, z, rotation) => {
          const scene = createDemoScene();
          scene.objects.find((o) => o.id === 'bedside-right')!.locks.rotation = true;
          const before = structuredClone(scene);
          const result = propose(scene, {
            type: 'transform',
            objectId: 'bed',
            mode: 'smart',
            transform: { x: x / 10, y: 0, z: z / 10, rotation },
          });
          if (result.ok) {
            expect(validateScene(result.scene)).toEqual([]);
            for (const object of scene.objects)
              expect(
                lockConflicts(
                  object,
                  result.scene.objects.find((o) => o.id === object.id)!,
                ),
              ).toEqual([]);
          }
          expect(scene).toEqual(before);
        },
      ),
      { numRuns: 60, seed: 4298 },
    );
  });
});
