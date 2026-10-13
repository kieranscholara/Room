import { z } from 'zod';

const id = z.string().min(1).max(100);
const coordinate = z.number().finite().min(-100).max(100);
export const transformSchema = z
  .object({
    x: coordinate,
    y: z.literal(0),
    z: coordinate,
    rotation: z
      .number()
      .finite()
      .min(-Math.PI * 2)
      .max(Math.PI * 2),
  })
  .strict();
export const locksSchema = z
  .object({ position: z.boolean(), rotation: z.boolean(), product: z.boolean() })
  .strict();
export const objectSchema = z
  .object({
    id,
    sku: id,
    variantId: id,
    name: z.string().min(1).max(100),
    category: z.enum(['bed', 'wardrobe', 'bedside', 'rug', 'desk']),
    dimensions: z
      .object({
        width: z.number().positive().max(20),
        depth: z.number().positive().max(20),
        height: z.number().positive().max(10),
      })
      .strict(),
    transform: transformSchema,
    locks: locksSchema,
    solid: z.boolean(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    // Explicit relationships; a follower's offset is in its anchor's local X/Z axes.
    follows: z
      .object({ anchorId: id, x: coordinate, z: coordinate, rotation: z.number().finite() })
      .strict()
      .optional(),
  })
  .strict();
export const zoneSchema = z
  .object({
    id,
    name: z.string().min(1),
    kind: z.enum(['door', 'obstacle', 'clearance']),
    x: coordinate,
    z: coordinate,
    width: z.number().positive(),
    depth: z.number().positive(),
  })
  .strict();
export const sceneSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    organisationId: id,
    version: z.number().int().nonnegative(),
    room: z
      .object({
        name: z.string().min(1).max(100),
        width: z.number().min(2).max(30),
        depth: z.number().min(2).max(30),
        height: z.number().min(2).max(6),
        measurementsConfirmed: z.boolean(),
        zones: z.array(zoneSchema).max(50),
      })
      .strict(),
    objects: z.array(objectSchema).max(30),
  })
  .strict()
  .superRefine((scene, ctx) => {
    const ids = new Set<string>();
    for (const object of scene.objects) {
      if (ids.has(object.id))
        ctx.addIssue({ code: 'custom', message: 'Duplicate object ID', path: ['objects'] });
      ids.add(object.id);
    }
    for (const object of scene.objects) {
      if (object.follows && (!ids.has(object.follows.anchorId) || object.follows.anchorId === object.id))
        ctx.addIssue({ code: 'custom', message: 'Invalid group anchor', path: ['objects'] });
      if (object.follows && scene.objects.find((o) => o.id === object.follows?.anchorId)?.follows)
        ctx.addIssue({
          code: 'custom',
          message: 'Nested groups are not supported in schema v1',
          path: ['objects'],
        });
    }
    if (new Set(scene.room.zones.map((zone) => zone.id)).size !== scene.room.zones.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate zone ID' });
    for (const zone of scene.room.zones) {
      if (
        zone.x < 0 ||
        zone.z < 0 ||
        zone.x + zone.width > scene.room.width ||
        zone.z + zone.depth > scene.room.depth
      )
        ctx.addIssue({ code: 'custom', message: 'Architectural zone must be inside the room' });
    }
  });
export const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('transform'),
      objectId: id,
      transform: transformSchema,
      mode: z.enum(['manual', 'smart']),
    })
    .strict(),
  z.object({ type: z.literal('locks'), objectId: id, locks: locksSchema }).strict(),
]);
export const requestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('preview'),
      expectedVersion: z.number().int().nonnegative(),
      operation: operationSchema,
    })
    .strict(),
  z
    .object({ action: z.literal('accept'), expectedVersion: z.number().int().nonnegative(), proposalId: id })
    .strict(),
  z.object({ action: z.literal('undo'), expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('redo'), expectedVersion: z.number().int().nonnegative() }).strict(),
]);
export type Scene = z.infer<typeof sceneSchema>;
export type SceneObject = z.infer<typeof objectSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type Request = z.infer<typeof requestSchema>;
export interface Conflict {
  code: string;
  message: string;
  objectIds: string[];
}
export type LayoutResult =
  | { ok: true; scene: Scene; movedIds: string[]; evaluated: number }
  | { ok: false; conflicts: Conflict[]; alternatives: string[] };
export interface Proposal {
  id: string;
  baseVersion: number;
  scene: Scene;
  movedIds: string[];
  evaluated: number;
}
export interface EditorState {
  scene: Scene;
  canUndo: boolean;
  canRedo: boolean;
}

export function sameTransform(a: Transform, b: Transform): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.rotation === b.rotation;
}
export function lockConflicts(before: SceneObject, after: SceneObject): Conflict[] {
  const conflicts: Conflict[] = [];
  const a = before.transform,
    b = after.transform;
  if (before.locks.position && (a.x !== b.x || a.y !== b.y || a.z !== b.z))
    conflicts.push({
      code: 'position-lock',
      message: `${before.name}'s position is locked. Unlock it before moving.`,
      objectIds: [before.id],
    });
  if (before.locks.rotation && a.rotation !== b.rotation)
    conflicts.push({
      code: 'rotation-lock',
      message: `${before.name}'s rotation is locked.`,
      objectIds: [before.id],
    });
  if (before.locks.product && (before.sku !== after.sku || before.variantId !== after.variantId))
    conflicts.push({
      code: 'product-lock',
      message: `${before.name}'s product is locked.`,
      objectIds: [before.id],
    });
  return conflicts;
}

// Synthetic products, explicitly for engineering acceptance; never retailer stock or quotations.
export function createDemoScene(): Scene {
  const furniture = (
    id: string,
    name: string,
    category: SceneObject['category'],
    width: number,
    depth: number,
    height: number,
    x: number,
    z: number,
    color: string,
    solid = true,
  ): SceneObject => ({
    id,
    name,
    category,
    sku: `DEMO-${id.toUpperCase()}`,
    variantId: 'demo-natural',
    dimensions: { width, depth, height },
    transform: { x, y: 0, z, rotation: 0 },
    locks: { position: false, rotation: false, product: false },
    color,
    solid,
  });
  const bed = furniture('bed', 'Oak bed', 'bed', 1.6, 2, 1, 3, 1.2, '#b89372');
  const left = furniture('bedside-left', 'Left bedside', 'bedside', 0.5, 0.5, 0.55, 1.8, 0.5, '#c7b49b');
  const right = furniture('bedside-right', 'Right bedside', 'bedside', 0.5, 0.5, 0.55, 4.2, 0.5, '#c7b49b');
  left.follows = { anchorId: 'bed', x: -1.2, z: -0.7, rotation: 0 };
  right.follows = { anchorId: 'bed', x: 1.2, z: -0.7, rotation: 0 };
  const rug = furniture('rug', 'Woven rug', 'rug', 2.8, 2.4, 0.02, 3, 1.7, '#ded6c9', false);
  rug.follows = { anchorId: 'bed', x: 0, z: 0.5, rotation: 0 };
  const wardrobe = furniture('wardrobe', 'Oak wardrobe', 'wardrobe', 0.65, 1.8, 2.1, 5.55, 3.4, '#8d7561');
  wardrobe.locks = { position: true, rotation: true, product: true };
  return sceneSchema.parse({
    schemaVersion: 1,
    id: 'demo-bedroom',
    organisationId: 'local-demo',
    version: 0,
    room: {
      name: 'The calm bedroom',
      width: 6,
      depth: 5,
      height: 2.7,
      measurementsConfirmed: true,
      zones: [{ id: 'door', name: 'Door clearance', kind: 'door', x: 0, z: 3.8, width: 1.1, depth: 1.2 }],
    },
    objects: [rug, bed, left, right, wardrobe],
  });
}
