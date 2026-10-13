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
    kind: z.enum(['door', 'obstacle', 'clearance', 'circulation']),
    x: coordinate,
    z: coordinate,
    width: z.number().positive(),
    depth: z.number().positive(),
  })
  .strict();
export const openingSchema = z
  .object({
    id,
    name: z.string().min(1).max(100),
    kind: z.enum(['door', 'window']),
    wall: z.enum(['north', 'east', 'south', 'west']),
    // Offset is measured from the west corner on north/south, north corner on east/west.
    offset: z.number().finite().nonnegative().max(30),
    width: z.number().finite().positive().max(30),
    height: z.number().finite().positive().max(6),
    sillHeight: z.number().finite().nonnegative().max(6),
    // Doors reserve the full swing envelope, conservatively represented as a rectangle.
    clearanceDepth: z.number().finite().positive().max(30),
  })
  .strict();
export const roomSchema = z
  .object({
    name: z.string().min(1).max(100),
    width: z.number().finite().min(2).max(30),
    depth: z.number().finite().min(2).max(30),
    height: z.number().finite().min(2).max(6),
    measurementsConfirmed: z.boolean(),
    zones: z.array(zoneSchema).max(50),
    openings: z.array(openingSchema).max(50).default([]),
  })
  .strict()
  .superRefine((room, ctx) => {
    if (new Set(room.zones.map((zone) => zone.id)).size !== room.zones.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate zone ID' });
    for (const zone of room.zones) {
      if (zone.x < 0 || zone.z < 0 || zone.x + zone.width > room.width || zone.z + zone.depth > room.depth)
        ctx.addIssue({ code: 'custom', message: 'Architectural zone must be inside the room' });
    }
    if (new Set(room.openings.map((opening) => opening.id)).size !== room.openings.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate opening ID' });
    for (const opening of room.openings) {
      const horizontal = opening.wall === 'north' || opening.wall === 'south';
      const length = horizontal ? room.width : room.depth;
      const perpendicular = horizontal ? room.depth : room.width;
      if (opening.offset + opening.width > length || opening.clearanceDepth > perpendicular)
        ctx.addIssue({ code: 'custom', message: 'Opening and its clearance must fit within the room' });
      if (opening.sillHeight + opening.height > room.height)
        ctx.addIssue({ code: 'custom', message: 'Opening extends above the ceiling' });
      if (opening.kind === 'door' && (opening.sillHeight !== 0 || opening.clearanceDepth < opening.width))
        ctx.addIssue({
          code: 'custom',
          message: 'A door must reach the floor and reserve at least its full swing depth',
        });
    }
  });
export const groupSchema = z
  .object({
    id,
    name: z.string().min(1).max(100),
    objectIds: z.array(id).min(2).max(30),
    locked: z.boolean(),
  })
  .strict();
const legacyRoomSchema = z
  .object({
    name: z.string().min(1).max(100),
    width: z.number().min(2).max(30),
    depth: z.number().min(2).max(30),
    height: z.number().min(2).max(6),
    measurementsConfirmed: z.boolean(),
    zones: z
      .array(zoneSchema.omit({ kind: true }).extend({ kind: z.enum(['door', 'obstacle', 'clearance']) }))
      .max(50),
  })
  .strict();
const sceneFields = {
  id,
  organisationId: id,
  version: z.number().int().nonnegative(),
  objects: z.array(objectSchema).max(30),
};
const canonicalSceneSchema = z
  .object({
    ...sceneFields,
    schemaVersion: z.literal(2),
    room: roomSchema,
    groups: z.array(groupSchema).max(15).default([]),
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
          message: 'Nested soft relationships are not supported',
          path: ['objects'],
        });
    }
    const grouped = new Set<string>();
    if (new Set(scene.groups.map((group) => group.id)).size !== scene.groups.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate group ID', path: ['groups'] });
    for (const group of scene.groups) {
      for (const objectId of group.objectIds) {
        if (!ids.has(objectId))
          ctx.addIssue({ code: 'custom', message: 'Group references missing furniture', path: ['groups'] });
        if (grouped.has(objectId))
          ctx.addIssue({
            code: 'custom',
            message: 'Furniture may belong to only one rigid group',
            path: ['groups'],
          });
        grouped.add(objectId);
      }
    }
  });
const legacySceneSchema = z
  .object({ ...sceneFields, schemaVersion: z.literal(1), room: legacyRoomSchema })
  .strict();
// Strictly recognise v1 before upgrading; unknown versions and fields remain invalid.
export const sceneSchema = z.preprocess((input) => {
  if (typeof input === 'object' && input !== null && 'schemaVersion' in input && input.schemaVersion === 1) {
    const legacy = legacySceneSchema.safeParse(input);
    if (legacy.success)
      return { ...legacy.data, schemaVersion: 2, room: { ...legacy.data.room, openings: [] }, groups: [] };
  }
  return input;
}, canonicalSceneSchema);
// Explicit migration preserves IDs, versions, dimensions, locks and transforms exactly.
export function migrateScene(input: unknown): Scene {
  return sceneSchema.parse(input);
}
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
  z.object({ type: z.literal('room'), room: roomSchema }).strict(),
  z.object({ type: z.literal('group'), group: groupSchema }).strict(),
  z.object({ type: z.literal('group-remove'), groupId: id }).strict(),
  z.object({ type: z.literal('add-object'), object: objectSchema }).strict(),
  z.object({ type: z.literal('remove-object'), objectId: id }).strict(),
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
export type Room = z.infer<typeof roomSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type Zone = z.infer<typeof zoneSchema>;
export type FurnitureGroup = z.infer<typeof groupSchema>;
export type Group = z.infer<typeof groupSchema>;
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
    schemaVersion: 2,
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
